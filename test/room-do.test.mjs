// Room(Durable Object)とルーム作成制限のテスト。Cloudflareの実行環境は使わず、DO・D1・WebSocketを簡易な代役で動かす。
// D1の代役には node:sqlite を使うので、SQL(枠の取得・返却)は本物のSQLiteで確かめる。node:sqlite が無い Node では、その部分だけ飛ばす。
import assert from 'node:assert/strict';

// ── Workers固有のものの代役 ──
class FakeResponse {
  constructor(body, init = {}) { this.body = body; this.status = init.status ?? 200; this.webSocket = init.webSocket; this.headers = init.headers; }
  get ok() { return this.status >= 200 && this.status < 300; }
  async json() { return JSON.parse(this.body); }
}
globalThis.Response = FakeResponse; // Node の Response は 101 を作れない
class FakeWs {
  constructor() { this.sent = []; this.closed = null; this.att = null; this.readyState = 1; }
  send(m) { if (this.closed) throw new Error('closed'); this.sent.push(JSON.parse(m)); }
  close(code, reason) { this.closed = { code, reason }; this.readyState = 3; }
  serializeAttachment(v) { this.att = JSON.parse(JSON.stringify(v)); }
  deserializeAttachment() { return this.att; }
  last(t) { return [...this.sent].reverse().find((m) => m.t === t); }
}
globalThis.WebSocketPair = class { constructor() { this[0] = new FakeWs(); this[1] = new FakeWs(); } };

const { Room } = await import('../worker/index.js');
const { acquireSlot, releaseSlot, ROOM_CREATE_COOLDOWN_MS } = await import('../worker/room-limit.js');

function makeCtx() {
  const store = new Map(); let alarm = null; const sockets = [];
  return {
    store, sockets,
    get alarm() { return alarm; },
    storage: {
      async get(k) { return store.get(k); },
      async put(k, v) { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) store.set(a, b); else store.set(k, v); },
      async setAlarm(t) { alarm = t; },
      async deleteAll() { store.clear(); alarm = null; }
    },
    getWebSockets() { return sockets.filter((w) => !w.closed); },
    acceptWebSocket(ws) { sockets.push(ws); }
  };
}
const req = (path, o = {}) => ({ url: 'https://room' + path, method: o.method || 'GET', headers: { get: (k) => (k.toLowerCase() === 'upgrade' ? 'websocket' : null) }, json: async () => o.body });
const sha = async (t) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t))), (b) => b.toString(16).padStart(2, '0')).join('');

async function newRoom(env = {}) {
  const ctx = makeCtx();
  const room = new Room(ctx, env);
  const init = await room.fetch(req('/init', { method: 'POST', body: { serverId: 's1', code: 'ABC234', hostTokenHash: await sha('TOKEN'), ipHash: 'ip1' } }));
  assert.equal(init.status, 200);
  return { ctx, room };
}
const wsReq = (q) => req('/ws?' + q);
const connect = async (room, q) => { const r = await room.fetch(wsReq(q)); return r; };

// 1) ホスト: トークンが無い・違う人は入れない。正しい人が最初のホスト(p1)
{
  const { ctx, room } = await newRoom();
  assert.equal((await connect(room, 'host=1&name=A')).status, 403);
  assert.equal((await connect(room, 'host=1&token=WRONG')).status, 403);
  const ok = await connect(room, 'host=1&token=TOKEN&name=Host');
  assert.equal(ok.status, 101);
  const hello = ctx.sockets[0].last('hello');
  assert.equal(hello.id, 'p1'); assert.equal(hello.host, true); assert.equal(hello.resumed, false);
  assert.equal(await ctx.storage.get('status'), 'running');
  // ホスト待ちの間(= running になる前)は参加者を入れない、は別ケースで確認する。ここでは参加できる
  const j = await connect(room, 'name=Taro');
  assert.equal(j.status, 101);
  assert.equal(ctx.sockets[1].last('hello').id, 'p2');
  assert.equal(ctx.sockets[0].last('peer-join').id, 'p2'); // ホストへ通知
}

// 2) ホスト不在(waiting)の間は参加できない
{
  const { room } = await newRoom();
  assert.equal((await connect(room, 'name=Taro')).status, 409);
}

// 3) ホストのWebSocketだけ切れた: すぐには終わらず、猶予の間は参加不可・再接続できる。再接続でP2P中の参加者の一覧が返る
{
  const { ctx, room } = await newRoom();
  await connect(room, 'host=1&token=TOKEN&name=Host');
  await connect(room, 'name=Taro');
  const [host, taro] = ctx.sockets;
  await room.webSocketClose(host, 1006);
  assert.equal(await ctx.storage.get('status'), 'host-away');
  assert.ok(ctx.alarm > Date.now() && ctx.alarm <= Date.now() + 46000);
  assert.equal(taro.closed, null, '参加者は閉じられない(P2Pは続く)');
  assert.equal((await connect(room, 'name=Late')).status, 409, '不在の間は新規参加不可');
  assert.equal((await connect(room, 'host=1&token=WRONG')).status, 403);
  const back = await connect(room, 'host=1&token=TOKEN&name=Host');
  assert.equal(back.status, 101);
  const hello = ctx.sockets[ctx.sockets.length - 1].last('hello');
  assert.equal(hello.id, 'p1'); assert.equal(hello.resumed, true);
  assert.deepEqual(hello.peers, [{ id: 'p2', name: 'Taro' }]);
  assert.equal(await ctx.storage.get('status'), 'running');
}

// 4) 古い接続が残っていても(切れに気づく前)、正しいトークンなら入れ替わる。古い方のcloseは退出扱いにならない
{
  const { ctx, room } = await newRoom();
  await connect(room, 'host=1&token=TOKEN');
  const old = ctx.sockets[0];
  await connect(room, 'host=1&token=TOKEN');
  assert.deepEqual(old.closed, { code: 4000, reason: 'replaced' });
  await room.webSocketClose(old, 4000);
  assert.equal(await ctx.storage.get('status'), 'running');
}

// 5) 猶予が切れたら終了。参加者に通知して閉じる。終了後は参加不可
{
  const { ctx, room } = await newRoom();
  await connect(room, 'host=1&token=TOKEN');
  await connect(room, 'name=Taro');
  const [host, taro] = ctx.sockets;
  await room.webSocketClose(host, 1006);
  await ctx.storage.put('graceUntil', Date.now() - 1); // 猶予が過ぎたことにする
  await room.alarm();
  assert.equal(await ctx.storage.get('status'), 'closed');
  assert.equal(taro.last('closed').reason, 'host-left');
  assert.equal((await connect(room, 'name=Late')).status, 410);
  await room.alarm(); // 片付け
  assert.equal(ctx.store.size, 0);
}

// 6) ホストが自分から抜ける('close')と、猶予なしですぐ終了
{
  const { ctx, room } = await newRoom();
  await connect(room, 'host=1&token=TOKEN');
  await connect(room, 'name=Taro');
  const [host, taro] = ctx.sockets;
  await room.webSocketMessage(taro, JSON.stringify({ t: 'close' })); // 参加者が'close'を送っても無効
  assert.equal(await ctx.storage.get('status'), 'running');
  await room.webSocketMessage(host, JSON.stringify({ t: 'close' }));
  assert.equal(await ctx.storage.get('status'), 'closed');
  assert.equal(taro.last('closed').reason, 'host-left');
}

// 7) シグナリング: ホスト⇔参加者だけ。参加者同士は中継しない
{
  const { ctx, room } = await newRoom();
  await connect(room, 'host=1&token=TOKEN');
  await connect(room, 'name=A'); await connect(room, 'name=B');
  const [host, a, b] = ctx.sockets;
  await room.webSocketMessage(host, JSON.stringify({ t: 'signal', to: 'p2', data: { x: 1 } }));
  assert.deepEqual(a.last('signal'), { t: 'signal', from: 'p1', data: { x: 1 } });
  await room.webSocketMessage(a, JSON.stringify({ t: 'signal', to: 'p3', data: { x: 2 } }));
  assert.equal(b.last('signal'), undefined);
  await room.webSocketMessage(a, JSON.stringify({ t: 'signal', to: 'p1', data: { y: 1 } }));
  assert.equal(host.last('signal').from, 'p2');
}

// 8) 参加者のWebSocketが切れたらホストへ通知(P2P未成立のときの後始末用)。満員(8)で止まる
{
  const { ctx, room } = await newRoom();
  await connect(room, 'host=1&token=TOKEN');
  for (let i = 0; i < 7; i++) assert.equal((await connect(room, 'name=P' + i)).status, 101);
  assert.equal((await connect(room, 'name=Over')).status, 409);
  await room.webSocketClose(ctx.sockets[1], 1000);
  assert.equal(ctx.sockets[0].last('peer-leave').id, 'p2');
}

// 9) ホストが来なかったRoomは、alarmで片付く(クールダウンなし)
{
  const calls = [];
  const env = { DB: { prepare: (sql) => ({ bind: (...a) => ({ run: async () => { calls.push([sql, a]); return { meta: { changes: 1 } }; } }) }) } };
  const { ctx, room } = await newRoom(env);
  assert.ok(ctx.alarm <= Date.now() + 61000);
  await room.alarm();
  assert.equal(ctx.store.size, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1][0], null, 'closedAt=null: クールダウンを始めない');
  assert.deepEqual(calls[0][1].slice(1), ['ip1', 'ABC234']);
}

// ── 作成制限(本物のSQLiteで) ──
let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch (e) { /* 古いNode */ }
if (!DatabaseSync) console.log('room-do: node:sqlite が無いため、作成制限のSQLテストは飛ばしました');
else {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE room_limits (ip_hash TEXT PRIMARY KEY, active_room TEXT, last_closed_at INTEGER NOT NULL DEFAULT 0)`);
  const env = {
    DB: {
      prepare(sql) {
        const st = sqlite.prepare(sql);
        return {
          bind: (...a) => ({
            run: async () => ({ meta: { changes: st.run(...a).changes } }),
            first: async () => st.get(...a) ?? null
          })
        };
      }
    }
  };
  const alive = new Set();
  const isAlive = async (c) => alive.has(c);
  const T0 = 1_000_000_000_000;

  // 初回は取れる → 同じIPの2つ目は room_active
  alive.add('AAAAAA');
  assert.equal(await acquireSlot(env, 'ipA', 'AAAAAA', isAlive, T0), null);
  assert.deepEqual(await acquireSlot(env, 'ipA', 'BBBBBB', isAlive, T0 + 1000), { error: 'room_active' });
  // 別のIPは取れる
  assert.equal(await acquireSlot(env, 'ipB', 'CCCCCC', isAlive, T0), null);

  // ルームが終わる(クールダウン開始)→ 2分たつまでは cooldown、たてば取れる
  await releaseSlot(env, 'ipA', 'AAAAAA', T0 + 5000);
  alive.delete('AAAAAA');
  let v = await acquireSlot(env, 'ipA', 'DDDDDD', isAlive, T0 + 5000 + 30_000);
  assert.equal(v.error, 'cooldown'); assert.equal(v.retryAfter, 90);
  v = await acquireSlot(env, 'ipA', 'DDDDDD', isAlive, T0 + 5000 + ROOM_CREATE_COOLDOWN_MS - 1);
  assert.equal(v.error, 'cooldown'); assert.equal(v.retryAfter, 1);
  assert.equal(await acquireSlot(env, 'ipA', 'DDDDDD', isAlive, T0 + 5000 + ROOM_CREATE_COOLDOWN_MS), null);

  // 別のコードの返却は効かない(古いRoomが後から終わっても、いまのRoomの枠を外さない)
  await releaseSlot(env, 'ipA', 'AAAAAA', T0 + 999999);
  alive.add('DDDDDD');
  assert.deepEqual(await acquireSlot(env, 'ipA', 'EEEEEE', isAlive, T0 + 500_000), { error: 'room_active' });

  // DO側が落ちて枠だけ残った(記録上のRoomが生きていない)なら、枠を片付けて取り直せる
  alive.delete('DDDDDD');
  assert.equal(await acquireSlot(env, 'ipA', 'FFFFFF', isAlive, T0 + 500_000), null);

  // ホストが来なかったRoom(closedAt=null)はクールダウンを始めない
  await releaseSlot(env, 'ipA', 'FFFFFF', null);
  assert.equal(await acquireSlot(env, 'ipA', 'GGGGGG', isAlive, T0 + 500_001), null);
}
console.log('room-do: ok');

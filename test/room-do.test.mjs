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
  const init = await room.fetch(req('/init', { method: 'POST', body: { serverId: 's1', code: 'ABC234', ipHash: 'ip1' } }));
  assert.equal(init.status, 200);
  return { ctx, room };
}
const wsReq = (q) => req('/ws?' + q);
const connect = async (room, q) => room.fetch(wsReq(q));
const msg = (o) => JSON.stringify(o);

// 1) ホストはいない: 最初に来た人も、後から来た人も同じ扱い。idは参加順(p1, p2, …)でtokenが渡る。既存の全員へ peer-join
{
  const { ctx, room } = await newRoom();
  assert.equal(await ctx.storage.get('status'), 'waiting');
  assert.equal((await connect(room, 'name=A')).status, 101);
  const h1 = ctx.sockets[0].last('hello');
  assert.equal(h1.id, 'p1'); assert.equal(h1.resumed, false); assert.deepEqual(h1.peers, []);
  assert.match(h1.token, /^[0-9a-f]{32}$/);
  assert.equal(h1.host, undefined);
  assert.equal(await ctx.storage.get('status'), 'running');
  assert.equal((await connect(room, 'name=B')).status, 101);
  assert.equal((await connect(room, 'name=C')).status, 101);
  const h3 = ctx.sockets[2].last('hello');
  assert.equal(h3.id, 'p3'); assert.deepEqual(h3.peers, [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }]);
  assert.deepEqual(ctx.sockets[0].sent.filter((m) => m.t === 'peer-join').map((m) => m.id), ['p2', 'p3']); // 先にいた人へ通知
  assert.deepEqual(ctx.sockets[1].sent.filter((m) => m.t === 'peer-join').map((m) => m.id), ['p3']);
  assert.equal(ctx.sockets[2].last('peer-join'), undefined, '自分の参加は自分へ通知しない');
  assert.equal(await ctx.storage.get('m:p1').then((r) => r.h), await sha(h1.token), 'tokenはハッシュだけ保存');
  const info = await (await room.fetch(req('/info'))).json();
  assert.deepEqual(info, { serverId: 's1', status: 'running', players: 3, max: 8 });
}

// 2) シグナリング: 参加者どうしが直接中継できる(自分宛て・存在しない相手は無視)
{
  const { ctx, room } = await newRoom();
  await connect(room, 'name=A'); await connect(room, 'name=B'); await connect(room, 'name=C');
  const [a, b, c] = ctx.sockets;
  await room.webSocketMessage(a, msg({ t: 'signal', to: 'p3', data: { x: 1 } }));
  assert.deepEqual(c.last('signal'), { t: 'signal', from: 'p1', data: { x: 1 } });
  await room.webSocketMessage(c, msg({ t: 'signal', to: 'p2', data: { x: 2 } }));
  assert.deepEqual(b.last('signal'), { t: 'signal', from: 'p3', data: { x: 2 } });
  await room.webSocketMessage(a, msg({ t: 'signal', to: 'p1', data: {} }));
  assert.equal(a.last('signal'), undefined, '自分宛ては無視');
  await room.webSocketMessage(a, msg({ t: 'signal', to: 'p9', data: {} })); // 存在しない
  await room.webSocketMessage(a, 'not json'); await room.webSocketMessage(a, msg({ t: 'signal', to: 5 }));
  await room.webSocketMessage(a, 'x'.repeat(20000));
  assert.equal(b.sent.filter((m) => m.t === 'signal').length, 1);
}

// 3) 世界時刻: Roomを作ってからの経過秒を、送られた c といっしょに返す
{
  const { ctx, room } = await newRoom();
  await connect(room, 'name=A');
  await ctx.storage.put('createdAt', Date.now() - 12_500); // 12.5秒前に作られたことにする
  await room.webSocketMessage(ctx.sockets[0], msg({ t: 'time', c: 1234.5 }));
  const t = ctx.sockets[0].last('time');
  assert.equal(t.c, 1234.5); assert.ok(t.s > 12.4 && t.s < 13, '12.5秒ほど: ' + t.s);
  await room.webSocketMessage(ctx.sockets[0], msg({ t: 'time', c: 'x' }));
  await room.webSocketMessage(ctx.sockets[0], msg({ t: 'time' }));
  assert.equal(ctx.sockets[0].sent.filter((m) => m.t === 'time').length, 1, '不正な問い合わせには返さない');
}

// 4) 満員(8)で止まる。誰かが抜けたら peer-leave を全員へ。席が空けば入れる
{
  const { ctx, room } = await newRoom();
  for (let i = 0; i < 8; i++) assert.equal((await connect(room, 'name=P' + i)).status, 101);
  assert.equal((await connect(room, 'name=Over')).status, 409);
  await room.webSocketClose(ctx.sockets[1], 1000);
  for (const w of ctx.sockets) if (!w.closed) assert.equal(w.last('peer-leave').id, 'p2');
  assert.equal((await connect(room, 'name=New')).status, 101);
  assert.equal(ctx.sockets[ctx.sockets.length - 1].last('hello').id, 'p9', '抜けた人のidは使い回さない');
}

// 5) 再接続: tokenが合う本人だけ。同じidに戻り、peer-join は送らず、いまの名簿が返る
{
  const { ctx, room } = await newRoom();
  await connect(room, 'name=A'); await connect(room, 'name=B');
  const token = ctx.sockets[0].last('hello').token;
  await room.webSocketClose(ctx.sockets[0], 1006);
  assert.equal(ctx.sockets[1].last('peer-leave').id, 'p1');
  assert.equal((await connect(room, 'id=p1&token=WRONG')).status, 403);
  assert.equal((await connect(room, 'id=p1')).status, 403);
  assert.equal((await connect(room, 'id=p9&token=' + token)).status, 403);
  assert.equal((await connect(room, 'id=p2&token=' + token)).status, 403, '他人のidには使えない');
  const before = ctx.sockets[1].sent.filter((m) => m.t === 'peer-join').length;
  assert.equal((await connect(room, 'id=p1&token=' + token)).status, 101);
  const back = ctx.sockets[ctx.sockets.length - 1];
  const hello = back.last('hello');
  assert.equal(hello.id, 'p1'); assert.equal(hello.resumed, true); assert.deepEqual(hello.peers, [{ id: 'p2', name: 'B' }]);
  assert.equal(ctx.sockets[1].sent.filter((m) => m.t === 'peer-join').length, before, '再接続は新規参加として通知しない');
  assert.equal(ctx.sockets[1].last('peer-back').id, 'p1', '戻ったことは peer-back で知らせる(P2Pが切れていれば張り直してもらう)');
  // 再接続後も同じ名前のまま
  await connect(room, 'name=C');
  assert.deepEqual(ctx.sockets[ctx.sockets.length - 1].last('hello').peers, [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }]);
}

// 6) 古い接続が残っていても(切れに気づく前)、正しいtokenなら入れ替わる。古い方のcloseは退出扱いにならない
{
  const { ctx, room } = await newRoom();
  await connect(room, 'name=A'); await connect(room, 'name=B');
  const old = ctx.sockets[0];
  await connect(room, 'id=p1&token=' + old.last('hello').token);
  assert.deepEqual(old.closed, { code: 4000, reason: 'replaced' });
  const sentBefore = ctx.sockets[1].sent.length;
  await room.webSocketClose(old, 4000);
  assert.equal(ctx.sockets[1].sent.length, sentBefore, 'peer-leave は送らない');
  assert.equal(await ctx.storage.get('status'), 'running');
  assert.equal((await (await room.fetch(req('/info'))).json()).players, 2);
}

// 7) 全員のWebSocketが切れたら、猶予の間は待つ(再接続できる)。猶予が切れたら片付ける(クールダウン開始)
{
  const calls = [];
  const env = { DB: { prepare: (sql) => ({ bind: (...a) => ({ run: async () => { calls.push([sql, a]); return { meta: { changes: 1 } }; } }) }) } };
  const { ctx, room } = await newRoom(env);
  await connect(room, 'name=A'); await connect(room, 'name=B');
  const [a, b] = ctx.sockets;
  const token = a.last('hello').token;
  await room.webSocketClose(a, 1006);
  assert.ok(ctx.alarm > Date.now() + 100_000, '1人残っている間は猶予を始めない');
  await room.webSocketClose(b, 1006);
  assert.ok(ctx.alarm > Date.now() && ctx.alarm <= Date.now() + 46000, '全員いなくなったら45秒の猶予');
  assert.equal((await connect(room, 'id=p1&token=' + token)).status, 101, '猶予の間は戻れる');
  assert.ok(ctx.alarm > Date.now() + 100_000, '戻ったら猶予は解ける');
  await room.alarm(); // まだ1人いるので片付かない
  assert.equal(ctx.store.size > 0, true);
  await room.webSocketClose(ctx.sockets[ctx.sockets.length - 1], 1006);
  await room.alarm(); // 猶予が切れた
  assert.equal(ctx.store.size, 0);
  assert.equal(calls.length, 1);
  assert.equal(typeof calls[0][1][0], 'number', 'closedAt=時刻: クールダウンを始める');
  assert.deepEqual(calls[0][1].slice(1), ['ip1', 'ABC234']);
  assert.equal((await connect(room, 'name=Late')).status, 404, '片付いたRoomには入れない');
}

// 8) 誰も来なかったRoomは、alarmで片付く(クールダウンなし)
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

// 9) 同じコードで作り直せない
{
  const { room } = await newRoom();
  const again = await room.fetch(req('/init', { method: 'POST', body: { serverId: 's2', code: 'ABC234' } }));
  assert.equal(again.status, 409);
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

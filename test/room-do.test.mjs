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

// 1) Room作成者の特権はなく、最初に接続したPeerが暫定Authorityになる
{
  const { ctx, room } = await newRoom();
  const ok = await connect(room, 'authority=1&name=Creator');
  assert.equal(ok.status, 101);
  const authority = ctx.sockets[0];
  const hello = authority.last('hello');
  assert.equal(hello.id, 'p1');
  assert.equal(hello.authority, true);
  assert.equal(hello.host, true, '既存のSession API互換のためhostフラグを維持');
  assert.equal(await ctx.storage.get('status'), 'running');
  const join = await connect(room, 'name=Taro');
  assert.equal(join.status, 101);
  assert.equal(ctx.sockets[1].last('hello').authorityId, 'p1');
  assert.equal(authority.last('peer-join').id, 'p2');
}

// 2) AuthorityがまだいないRoomには通常Peerは参加できない
{
  const { room } = await newRoom();
  assert.equal((await connect(room, 'name=Taro')).status, 409);
}

// 3) Authorityが退出しても、他のPeerが残っていればRoomとWebSocketを維持する
{
  const { ctx, room } = await newRoom();
  await connect(room, 'authority=1&name=Creator');
  await connect(room, 'name=A');
  await connect(room, 'name=B');
  const [authority, a, b] = ctx.sockets;
  await room.webSocketClose(authority, 1000);
  assert.equal(await ctx.storage.get('status'), 'waiting-authority');
  assert.equal(await ctx.storage.get('authorityId'), '');
  assert.equal(a.closed, null);
  assert.equal(b.closed, null);
  assert.equal(a.last('authority-left').id, 'p1');
  assert.equal(b.last('authority-left').id, 'p1');
  const info = await (await room.fetch(req('/info'))).json();
  assert.equal(info.players, 2);
  assert.equal(info.authorityAvailable, false);
  assert.equal((await connect(room, 'name=Late')).status, 409, 'Authority不在中は新規参加を保留');
}

// 4) 通常Peerの退出は残りのPeerへ通知し、最後の退出でRoomを終了する
{
  const { ctx, room } = await newRoom();
  await connect(room, 'authority=1&name=Creator');
  await connect(room, 'name=A');
  await connect(room, 'name=B');
  const [authority, a, b] = ctx.sockets;
  await room.webSocketClose(a, 1000);
  assert.equal(authority.last('peer-leave').id, 'p2');
  assert.equal(b.last('peer-leave').id, 'p2');
  await room.webSocketClose(b, 1000);
  assert.equal(await ctx.storage.get('status'), 'running');
  await room.webSocketClose(authority, 1000);
  assert.equal(await ctx.storage.get('status'), 'closed');
}

// 5) Authorityへのシグナリングだけ許可し、通常Peer同士の中継はしない。満員(8人)で止まる
{
  const { ctx, room } = await newRoom();
  await connect(room, 'authority=1&name=Creator');
  for (let i = 0; i < 7; i++) assert.equal((await connect(room, 'name=P' + i)).status, 101);
  assert.equal((await connect(room, 'name=Over')).status, 409);
  const [authority, a, b] = ctx.sockets;
  await room.webSocketMessage(authority, JSON.stringify({ t: 'signal', to: 'p2', data: { x: 1 } }));
  assert.deepEqual(a.last('signal'), { t: 'signal', from: 'p1', data: { x: 1 } });
  await room.webSocketMessage(a, JSON.stringify({ t: 'signal', to: 'p3', data: { x: 2 } }));
  assert.equal(b.last('signal'), undefined);
}

// 6) 新規参加者の通知はAuthorityと既存Peer全員へ届く
{
  const { ctx, room } = await newRoom();
  await connect(room, 'authority=1&name=Creator');
  await connect(room, 'name=A');
  await connect(room, 'name=B');
  assert.equal(ctx.sockets[0].last('peer-join').id, 'p3');
  assert.equal(ctx.sockets[1].last('peer-join').id, 'p3');
}

// 7) ホストが来なかったRoomはalarmで片付く(クールダウンなし)
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

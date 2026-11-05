// NetSession(ホストレス・フルメッシュ)の結合テスト。本物の Room(Durable Object)に、WebSocketとWebRTCの代役をつないで動かす。
// 確かめること: 全員がつながる / 位置がバイナリで届く / 止まっている間は間引く / 世界時刻が揃う / 退出 / 後から入った人 / WebSocket再接続のあとに入った人
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: (k) => (k === 'rbxl.apiBase' ? 'http://room.test' : null), setItem() {} };

// ── Workers の代役(room-do.test.mjs と同じ考え方) ──
class FakeResponse {
  constructor(body, init = {}) { this.body = body; this.status = init.status ?? 200; this.webSocket = init.webSocket; }
  get ok() { return this.status >= 200 && this.status < 300; }
  async json() { return JSON.parse(this.body); }
}
globalThis.Response = FakeResponse;
class SrvWs { // Room側のWebSocket
  constructor() { this.att = null; this.closed = null; this.readyState = 1; this.client = null; this.pending = []; }
  send(m) { if (this.closed) throw new Error('closed'); if (!this.client) { this.pending.push(m); return; } const c = this.client; queueMicrotask(() => c.onmessage?.({ data: m })); }
  close(code, reason) { if (this.closed) return; this.closed = { code, reason }; this.readyState = 3; const c = this.client; queueMicrotask(() => { if (c) { c.readyState = 3; c.onclose?.({ code }); } }); }
  serializeAttachment(v) { this.att = JSON.parse(JSON.stringify(v)); }
  deserializeAttachment() { return this.att; }
}
globalThis.WebSocketPair = class { constructor() { this[0] = {}; this[1] = new SrvWs(); } };
const { Room } = await import('../worker/index.js');
const sockets = []; const store = new Map();
globalThis.signalMessages = [];
const ctx = {
  storage: {
    async get(k) { return store.get(k); },
    async put(k, v) { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) store.set(a, b); else store.set(k, v); },
    async setAlarm() {}, async deleteAll() { store.clear(); }
  },
  getWebSockets: () => sockets.filter((w) => !w.closed),
  acceptWebSocket: (ws) => sockets.push(ws)
};
const room = new Room(ctx, {});
const req = (path, o = {}) => ({ url: 'https://room' + path, method: o.method || 'GET', headers: { get: (k) => (k.toLowerCase() === 'upgrade' ? 'websocket' : null) }, json: async () => o.body });
await room.fetch(req('/init', { method: 'POST', body: { serverId: 's1', code: 'ABC234', ipHash: '' } }));

// ── ブラウザの代役 ──
class FakeWebSocket { // クライアント側
  constructor(url) {
    this.readyState = 0; this.timeSent = 0;
    const q = new URL(url.replace(/^ws/, 'http')).search.slice(1);
    room.fetch(req('/ws?' + q)).then((res) => {
      if (res.status !== 101) { this.readyState = 3; this.onclose?.({ code: 1006 }); return; }
      const srv = sockets[sockets.length - 1];
      this.srv = srv; srv.client = this; this.readyState = 1;
      for (const m of srv.pending.splice(0)) queueMicrotask(() => this.onmessage?.({ data: m }));
    });
  }
  send(m) { const parsed = JSON.parse(m); if (parsed.t === 'signal') globalThis.signalMessages.push(parsed); if (parsed.t === 'time') this.timeSent++; room.webSocketMessage(this.srv, m); }
  close() { if (this.readyState === 3) return; this.readyState = 3; room.webSocketClose(this.srv, 1000); }
}
globalThis.WebSocket = FakeWebSocket;
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ serverId: 's1', status: 'running', players: 1, max: 8 }) });

const pcs = new Map(); let pcSeq = 0;
class FakeDC {
  constructor(label) { this.label = label; this.readyState = 'connecting'; this.bufferedAmount = 0; this.binaryType = 'blob'; this.rx = 0; this.remote = null; }
  send(data) {
    const r = this.remote;
    if (this.readyState !== 'open' || !r) return;
    const copy = typeof data === 'string' ? data : data.slice(0);
    queueMicrotask(() => { if (r.readyState === 'open') { r.rx++; r.onmessage?.({ data: copy }); } });
  }
}
class FakePC {
  constructor() { this.id = 'pc' + (++pcSeq); this.dcs = {}; this.connectionState = 'new'; this.localDescription = null; this.addedCandidates = []; pcs.set(this.id, this); }
  createDataChannel(label) { return (this.dcs[label] = new FakeDC(label)); }
  async createOffer() { return { type: 'offer', sdp: 'fake:' + this.id }; }
  async createAnswer() { return { type: 'answer', sdp: 'fake:' + this.id }; }
  async setLocalDescription(d) { this.localDescription = d; }
  async setRemoteDescription(d) {
    const other = pcs.get(d.sdp.slice(5));
    if (d.type === 'answer' && other) { // 答えが届いたら、両側のチャネルがつながる
      for (const label of ['ctl', 'st']) {
        const a = this.dcs[label], b = other.dcs[label];
        a.remote = b; b.remote = a;
        setTimeout(() => { a.readyState = 'open'; b.readyState = 'open'; a.onopen?.(); b.onopen?.(); }, 0);
      }
    }
  }
  async addIceCandidate(candidate) { this.addedCandidates.push(candidate); }
  close() {
    this.connectionState = 'closed';
    for (const dc of Object.values(this.dcs)) {
      dc.readyState = 'closed';
      const r = dc.remote;
      if (r && r.readyState === 'open') queueMicrotask(() => { r.readyState = 'closed'; r.onclose?.(); });
    }
  }
}
globalThis.RTCPeerConnection = FakePC;

const { NetSession } = await import('../src/net/session.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return; await sleep(10); }
  assert.fail('時間切れ: ' + what);
}
function mk(name, v) {
  const o = { name, state: { v }, log: { players: [], snap: [], ready: false, closed: null, status: [] } };
  o.s = new NetSession({
    code: 'ABC234', name, sendHz: 30,
    getLocal: () => o.state.v,
    onStatus: (t) => o.log.status.push(t), onReady: () => { o.log.ready = true; },
    onPlayers: (l) => { o.log.players = l; }, onSnapshot: (l) => { o.log.snap = l; }, onClosed: (r) => { o.log.closed = r; }
  });
  o.s.connect();
  return o;
}
const near = (a, b, tol = 1 / 64) => Math.abs(a - b) <= tol;
const entry = (o, id) => o.log.snap.find((e) => e.id === id);

// 1) 3人がつながる。ホストはいない(全員が対等)
const a = mk('A', [10, 5, -3, 1, 16, 1]);
await until(() => a.log.ready, 'A参加');
await sleep(520); // 150ms間隔の初回バーストが完了するまで待つ
assert.equal(a.s.ws.timeSent, 4, '初回のRoom時計問い合わせは4回');
const b = mk('B', [20, 6, 7, 2, 0, 1]);
await until(() => b.log.ready, 'B参加');
const c = mk('C', [-30, 1, 2, 3, 8, 0]);
await until(() => [a, b, c].every((x) => x.log.players.length === 3), '3人の名簿');
assert.deepEqual([a.s.id, b.s.id, c.s.id], ['p1', 'p2', 'p3']);
assert.deepEqual(a.log.players.map((p) => p.name).sort(), ['A', 'B', 'C']);
assert.ok([a, b, c].every((x) => x.s.peers.size === 2), '全員が全員と1本ずつつながる(二重の接続がない)');

// ICE候補は5件で即時バッチ化し、少数の残りは50ms以内にまとめる。
{
  const ab = a.s.peers.get('p2'), ba = b.s.peers.get('p1');
  let before = signalMessages.length;
  for (let i = 0; i < 5; i++) ab.pc.onicecandidate({ candidate: { toJSON: () => ({ candidate: 'candidate:' + i }) } });
  await until(() => signalMessages.length === before + 1, 'ICE 5件の即時バッチ');
  assert.equal(signalMessages.at(-1).data.cs.length, 5);
  assert.deepEqual(signalMessages.at(-1).data.cs.map((x) => x.candidate), ['candidate:0', 'candidate:1', 'candidate:2', 'candidate:3', 'candidate:4']);
  await until(() => ba.pc.addedCandidates.length === 5, 'ICEバッチの受信');

  before = signalMessages.length;
  for (let i = 5; i < 7; i++) ab.pc.onicecandidate({ candidate: { toJSON: () => ({ candidate: 'candidate:' + i }) } });
  await until(() => signalMessages.length === before + 1, 'ICE少数候補のタイマー送信', 1000);
  assert.equal(signalMessages.at(-1).data.cs.length, 2);
  await until(() => ba.pc.addedCandidates.length === 7, 'ICE少数候補の受信');

  before = signalMessages.length;
  ab.pc.onicecandidate({ candidate: { toJSON: () => ({ candidate: 'candidate:7' }) } });
  ab.pc.onicecandidate({ candidate: null });
  await until(() => signalMessages.length === before + 1, 'ICE gathering完了時のflush');
  assert.equal(signalMessages.at(-1).data.cs.length, 1);
  await until(() => ba.pc.addedCandidates.length === 8, 'ICE完了候補の受信');
}

// 2) 位置がバイナリで届く(量子化の誤差内)。自分は含まれない
await until(() => [a, b, c].every((x) => x.log.snap.length === 2), '全員の位置');
const eb = entry(a, 'p2');
assert.equal(eb.name, 'B');
assert.ok(near(eb.s[0], 20) && near(eb.s[1], 6) && near(eb.s[2], 7) && Math.abs(eb.s[3] - 2) < 1e-3 && eb.s[4] === 0 && eb.s[5] === 1);
assert.equal(entry(a, 'p1'), undefined);
b.state.v = [55.5, 6, 7, 2, 16, 1]; // Bが動く
await until(() => near(entry(a, 'p2').s[0], 55.5) && near(entry(c, 'p2').s[0], 55.5), 'Bの移動が届く');

// 3) 世界時刻: 全員が同じRoomの時計に合う
await until(() => [a, b, c].every((x) => x.s.getNetTime() !== null), '時計');
{
  const ts = [a, b, c].map((x) => x.s.getNetTime());
  assert.ok(Math.max(...ts) - Math.min(...ts) < 0.05, '時計のずれ: ' + ts.join(','));
}

// 4) 止まっている間は送る回数を間引く(動いているときは毎回送る)
{
  const rxFromA = () => b.s.peers.get('p1').st.rx;
  a.state.v = [10, 5, -3, 1, 0, 1]; await sleep(100);
  const idle0 = rxFromA(); await sleep(1100);
  const idle = rxFromA() - idle0;
  assert.ok(idle >= 1 && idle <= 4, '止まっている間: 1.1秒で ' + idle + ' パケット');
  let x = 0; const mv = setInterval(() => { a.state.v = [10 + (++x) * 0.5, 5, -3, 1, 16, 1]; }, 5);
  const move0 = rxFromA(); await sleep(500); clearInterval(mv);
  const moving = rxFromA() - move0;
  assert.ok(moving >= 10, '動いている間: 0.5秒で ' + moving + ' パケット');
}

// 5) 退出: 'bye' を受けて名簿と表示から消える
c.s.leave();
await until(() => a.log.players.length === 2 && b.log.players.length === 2, 'Cの退出');
await until(() => a.log.snap.length === 1 && b.log.snap.length === 1, 'Cの表示が消える');
assert.equal(c.log.closed, null, '自分で抜けたときは onClosed を呼ばない');

// 6) 後から入った人: 先にいた全員からofferが届いてつながる
const d = mk('D', [1, 2, 3, 0, 0, 1]);
await until(() => d.log.players.length === 3 && a.log.players.length === 3 && b.log.players.length === 3, 'Dの参加');
assert.equal(d.s.id, 'p4'); assert.equal(d.s.peers.size, 2);
await until(() => d.log.snap.length === 2 && entry(a, 'p4'), 'Dの位置');

// 7) Aのシグナリング(WebSocket)だけ切れる: P2Pは続き、裏で再接続し、そのあとに入った人ともつながる
a.s.ws.srv.close(1006, 'drop'); // 回線が切れた
await sleep(50);
assert.equal(a.log.closed, null, 'P2Pが生きているので終了しない');
assert.ok(entry(a, 'p2'), '切れている間もBの位置は届く');
await until(() => a.s.ws.readyState === 1 && a.s.ws.srv && !a.s.ws.srv.closed && a.s.reconnecting === false, 'Aが再接続', 6000);
const e = mk('E', [9, 9, 9, 0, 0, 1]);
await until(() => e.log.players.length === 4 && a.log.players.length === 4, 'Aの再接続後に入ったEとつながる');
assert.equal(e.s.id, 'p5'); assert.equal(e.s.peers.size, 3, 'E は A・B・D とつながる');

// 7b) P2P接続そのものが切れた(シグナリングは生きている): 先に入った側が出し直して、両側が自動でつなぎ直す
a.s._peerLost(a.s.peers.get('p2'), true); // Aが切れを検出。Bは相手のチャネルが閉じて気づく
await until(() => !entry(a, 'p2'), 'Bのアバターが一度消える');
await until(() => a.s.peers.get('p2')?.ready && b.s.peers.get('p1')?.ready && entry(a, 'p2') && entry(b, 'p1'), 'A-Bが自動でつなぎ直る', 8000);
assert.equal(a.s.peers.size, 3); assert.equal(b.s.peers.size, 3);

// 7c) 後から入った側(B)のシグナリングが切れている間に、先に入った相手(A)とのP2Pも切れた: 戻ったあと、Bの頼みでAが出し直す
{
  const srv = b.s.ws.srv;
  srv.close(1006, 'drop'); await room.webSocketClose(srv, 1006); // Roomは peer-leave を配る
  await sleep(30);
  b.s._peerLost(b.s.peers.get('p1'), true); // この間にA-B間のP2Pが切れる
  await until(() => a.s.peers.get('p2')?.ready && b.s.peers.get('p1')?.ready && entry(b, 'p1'), 'Bの再接続後にA-Bがつながる', 10000);
  assert.equal(b.log.closed, null); assert.equal(a.log.closed, null);
}

// 8) 全員が抜ける
for (const x of [a, b, d, e]) x.s.leave();
await sleep(300);
assert.ok([a, b, d, e].every((x) => x.s.peers.size === 0));
console.log('net-session: ok');
process.exit(0);

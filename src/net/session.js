// P2Pマルチプレイのセッション(ブラウザ専用)。Host型Star: ホストが全員とWebRTCでつながり、状態を中継する。
// Durable Object(worker/index.js の Room)はシグナリングと参加・退出の通知だけ。ゲームのデータは流さない。
// - ホストが抜けたらRoom終了(ホスト交代なし)。ただしホストの「DOとのWebSocket」が一時的に切れただけなら、
//   hostToken で再接続でき(猶予あり)、その間もP2Pは続く。
// - 他プレイヤーの移動は各自が計算して送る(位置の表示と世界時刻の同期まで)。
import { CONFIG } from '../config.js';
import {
  ICE_SERVERS, DEFAULT_SEND_HZ, MAX_PLAYERS, PEER_TIMEOUT_MS, CTL_MAX_PER_SEC,
  encode, decode, cleanName, packState, validState, validSnapshot, validPlayers, validSeq
} from './protocol.js';
import { ClockSync } from './clock.js';

const base = () => CONFIG.apiBase.replace(/\/+$/, '');
const P2P_TIMEOUT_MS = 15000;
const HOST_RECONNECT_MS = 40000; // DO側の猶予(45秒)より短くする
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function roomRequest(path, options) {
  if (!base()) throw new Error('API_NOT_CONFIGURED');
  const res = await fetch(base() + path, options);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((body && body.error) || 'HTTP_' + res.status);
    err.status = res.status;
    if (body && Number.isFinite(body.retryAfter)) err.retryAfter = body.retryAfter;
    throw err;
  }
  return body;
}

/** ルームを作る。{ roomId, hostToken } を返す(roomId = 6文字のコード。hostToken はホストの再接続用で、他人に見せない) */
export const createRoom = (serverId) => roomRequest('/api/rooms', {
  method: 'POST',
  // 管理用の合言葉を設定している人は、作成の回数制限を受けない(開発・検証用)
  headers: { 'Content-Type': 'application/json', ...(CONFIG.adminPassphrase ? { Authorization: 'Bearer ' + CONFIG.adminPassphrase } : {}) },
  body: JSON.stringify({ serverId })
});
/** ルームの情報。{ serverId, status, players, max } */
export const getRoomInfo = (code) => roomRequest(`/api/rooms/${code}/info`);

const wsUrl = (code, name, asHost, token) => base().replace(/^http/, 'ws')
  + `/api/rooms/${code}/ws?name=${encodeURIComponent(name)}${asHost ? '&host=1&token=' + encodeURIComponent(token || '') : ''}`;

export class NetSession {
  /**
   * @param o { code, name, asHost, token(ホストのみ), sendHz, getLocal:()=>[x,y,z,heading,speed,grounded], getTime:()=>秒(ホストの世界時刻),
   *            onStatus(text), onReady(session), onPlayers([{id,name}]), onSnapshot([{id,name,s}]), onClosed(reason) }
   */
  constructor(o) {
    this.o = o;
    this.code = o.code;
    this.sendHz = Math.min(30, Math.max(5, Number(o.sendHz) || DEFAULT_SEND_HZ));
    this.ws = null;
    this.id = ''; this.hostId = ''; this.isHost = false; this.ready = false; this.closed = false;
    this.peers = new Map(); this.players = new Map();
    this.timer = null; this.pingTimer = null;
    this.sync = new ClockSync();
    this.rtt = 0;
    this.seq = 0;        // ホスト: 送ったスナップショットの連番 / クライアント: 送った状態の連番
    this.lastSeq = -1;   // クライアント: 最後に採用したスナップショットの連番
    this.reconnecting = false; this.resumeWait = null;
  }

  connect() {
    this._status('接続中…');
    this._openWs();
  }

  leave() { this._end('left', true); }

  /** ホストの世界時刻(秒)の推定値。クライアントのみ。まだ分からなければ null */
  getNetTime() { return this.sync.time(); }

  _status(t) { this.o.onStatus?.(t); }
  _emitPlayers() { this.o.onPlayers?.([...this.players.values()]); }
  _emitSnapshot(list) {
    this.o.onSnapshot?.(list.filter((e) => e.id !== this.id).map((e) => ({ id: e.id, name: this.players.get(e.id)?.name || 'Player', s: e.s })));
  }
  _signal(to, data) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'signal', to, data })); }
  _sendCtl(peer, msg) { if (peer?.ctl.readyState === 'open') peer.ctl.send(encode(msg)); }
  _broadcastCtl(msg, exceptId) { for (const p of this.peers.values()) if (p.ready && p.id !== exceptId) this._sendCtl(p, msg); }

  // ── DO(シグナリング)とのWebSocket ──
  _openWs() {
    const ws = new WebSocket(wsUrl(this.code, cleanName(this.o.name), this.o.asHost, this.o.token));
    this.ws = ws;
    ws.onmessage = (e) => { if (this.ws === ws) this._onWs(e.data); };
    ws.onerror = () => {};
    ws.onclose = () => { if (this.ws === ws && !this.closed) this._onWsClosed(); };
  }

  // クライアントは、P2Pが成立したらDOが切れても続行できる。
  // ホストは、DOとの接続が切れたら(P2Pはそのままに)再接続を試み、だめなら終了する
  _onWsClosed() {
    if (this.resumeWait) { const r = this.resumeWait; this.resumeWait = null; r(false); return; }
    if (this.o.asHost && this.ready) this._reconnectHost();
    else if (this.o.asHost || !this.ready) this._end('signal-lost');
  }

  async _reconnectHost() {
    if (this.reconnecting) return;
    this.reconnecting = true;
    const deadline = performance.now() + HOST_RECONNECT_MS;
    let delay = 500;
    while (!this.closed && performance.now() < deadline) {
      this._status('ホストの接続を再開中…');
      await sleep(delay);
      delay = Math.min(delay * 2, 5000);
      if (this.closed) return;
      try { if ((await getRoomInfo(this.code)).status === 'closed') break; } catch (e) { if (e.status === 404) break; }
      const ok = await new Promise((resolve) => { this.resumeWait = resolve; this._openWs(); });
      if (ok) { this.reconnecting = false; this._status('ホストとして待機中'); return; }
    }
    this.reconnecting = false;
    this._end('signal-lost');
  }

  _onWs(raw) {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hello') {
      if (m.host && this.ready) { this._onResumed(m); return; } // ホストの再接続
      this.id = String(m.id); this.hostId = String(m.hostId); this.isHost = !!m.host;
      if (this.isHost) {
        this.players.set(this.id, { id: this.id, name: cleanName(this.o.name) });
        this.ready = true;
        this._emitPlayers();
        this._startTimer();
        this._status('ホストとして待機中');
        this.o.onReady?.(this);
      } else this._status('ホストと通信を準備中…');
    } else if (m.t === 'peer-join' && this.isHost) this._hostAccept(String(m.id), cleanName(m.name));
    else if (m.t === 'peer-leave' && this.isHost) {
      // 接続が成立済みの相手は、DOのWebSocketが切れてもP2Pが生きていれば続ける(切れたかどうかはP2P側の状態で決める)
      const p = this.peers.get(String(m.id));
      if (p && !p.ready) this._peerLost(p);
    } else if (m.t === 'signal') this._onSignal(String(m.from), m.data);
    else if (m.t === 'closed') this._end(m.reason === 'host-left' ? 'host-left' : 'closed');
  }

  // 再接続できた。留守の間に参加・退出した人をDOの一覧と突き合わせる
  _onResumed(m) {
    const list = Array.isArray(m.peers) ? m.peers.slice(0, MAX_PLAYERS) : [];
    const ids = new Set(list.map((p) => String(p && p.id)));
    for (const p of list) if (p && typeof p.id === 'string' && !this.peers.has(p.id)) this._hostAccept(p.id, cleanName(p.name));
    for (const peer of [...this.peers.values()]) if (!peer.ready && !ids.has(peer.id)) this._peerLost(peer); // 接続途中のまま消えた人
    const r = this.resumeWait; this.resumeWait = null; r?.(true);
  }

  _makePeer(id, name = '') {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    // 両側で同じidを指定して作る(negotiated)ので、offer/answerの順序に依存しない
    const ctl = pc.createDataChannel('ctl', { negotiated: true, id: 0 });
    const st = pc.createDataChannel('st', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 });
    const now = performance.now();
    const peer = { id, name, pc, ctl, st, pending: [], remoteSet: false, ready: false, gone: false, state: null, lastRx: 0, rxSeq: -1, lastSeen: now, ctlWindow: now, ctlCount: 0, timer: null };
    pc.onicecandidate = (e) => { if (e.candidate) this._signal(id, { c: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this._peerLost(peer); };
    ctl.onopen = () => this._onCtlOpen(peer);
    ctl.onclose = () => this._peerLost(peer);
    ctl.onmessage = (e) => this._onCtl(peer, decode(e.data));
    st.onmessage = (e) => this._onSt(peer, decode(e.data));
    peer.timer = setTimeout(() => { if (!peer.ready) this._peerLost(peer, true); }, P2P_TIMEOUT_MS);
    this.peers.set(id, peer);
    return peer;
  }

  async _hostAccept(id, name) {
    if (this.peers.has(id) || this.peers.size >= MAX_PLAYERS - 1) return; // ホストの分を除いた上限
    const peer = this._makePeer(id, name);
    try {
      await peer.pc.setLocalDescription(await peer.pc.createOffer());
      const d = peer.pc.localDescription;
      this._signal(id, { sdp: { type: d.type, sdp: d.sdp } });
    } catch (e) { this._peerLost(peer, true); }
  }

  async _onSignal(from, data) {
    if (!data || typeof data !== 'object') return;
    let peer = this.peers.get(from);
    try {
      if (data.sdp && (data.sdp.type === 'offer' || data.sdp.type === 'answer') && typeof data.sdp.sdp === 'string') {
        if (!peer) { if (this.isHost || from !== this.hostId) return; peer = this._makePeer(from); } // クライアントはホストのofferでPCを作る
        await peer.pc.setRemoteDescription({ type: data.sdp.type, sdp: data.sdp.sdp });
        peer.remoteSet = true;
        for (const c of peer.pending.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
        if (data.sdp.type === 'offer') {
          await peer.pc.setLocalDescription(await peer.pc.createAnswer());
          const d = peer.pc.localDescription;
          this._signal(from, { sdp: { type: d.type, sdp: d.sdp } });
        }
      } else if (data.c && peer) {
        if (peer.remoteSet) await peer.pc.addIceCandidate(data.c).catch(() => {});
        else if (peer.pending.length < 64) peer.pending.push(data.c);
      }
    } catch (e) { this._peerLost(peer, true); }
  }

  _onCtlOpen(peer) {
    clearTimeout(peer.timer);
    peer.ready = true;
    peer.lastSeen = performance.now();
    if (this.isHost) {
      this.players.set(peer.id, { id: peer.id, name: peer.name });
      this._sendCtl(peer, { t: 'welcome', id: peer.id, players: [...this.players.values()], h: this.o.getTime?.() ?? 0 });
      this._broadcastCtl({ t: 'join', id: peer.id, name: peer.name }, peer.id);
      this._emitPlayers();
    }
  }

  _onCtl(peer, m) {
    if (!m) return;
    const now = performance.now();
    peer.lastSeen = now;
    if (now - peer.ctlWindow > 1000) { peer.ctlWindow = now; peer.ctlCount = 0; }
    if (++peer.ctlCount > CTL_MAX_PER_SEC) return; // 制御メッセージの送りすぎは捨てる
    if (m.t === 'ping') { this._sendCtl(peer, { t: 'pong', c: m.c }); return; }
    if (this.isHost) {
      if (m.t === 'bye') this._peerLost(peer); // 相手が自分から抜けた(切断の検出を待たずに済む)
      return;
    }
    if (m.t === 'welcome') {
      const list = validPlayers(m.players);
      if (!list) return;
      this.players = new Map(list.map((p) => [p.id, p]));
      this.ready = true;
      if (Number.isFinite(m.h)) this.sync.sample(m.h); // 最初のスナップショットを待たずに時計を合わせる
      this._emitPlayers();
      this._startTimer();
      this.pingTimer = setInterval(() => this._sendCtl(this.peers.get(this.hostId), { t: 'ping', c: performance.now() }), 2000);
      this._status('参加しました');
      this.o.onReady?.(this);
    } else if (m.t === 'join' && typeof m.id === 'string' && this.players.size < MAX_PLAYERS) {
      this.players.set(m.id, { id: m.id, name: cleanName(m.name) }); this._emitPlayers();
    } else if (m.t === 'leave' && typeof m.id === 'string') {
      this.players.delete(m.id); this._emitPlayers();
    } else if (m.t === 'host-bye') {
      this._end('host-left');
    } else if (m.t === 'pong' && Number.isFinite(m.c)) {
      const rtt = performance.now() - m.c;
      this.rtt = this.rtt ? this.rtt * 0.7 + rtt * 0.3 : rtt;
      this.sync.setRtt(this.rtt);
    }
  }

  _onSt(peer, m) {
    if (!m) return;
    const now = performance.now();
    peer.lastSeen = now;
    if (this.isHost) {
      if (m.t !== 's') return;
      if (now - peer.lastRx < 1000 / (this.sendHz * 4)) return; // 送りすぎは捨てる
      if (!validSeq(m.n) || m.n <= peer.rxSeq) return;          // 順序が入れ替わった古い状態は使わない
      const s = validState(m.s);
      if (s) { peer.lastRx = now; peer.rxSeq = m.n; peer.state = s; }
    } else if (m.t === 'S') {
      const list = validSnapshot(m);
      if (!list || m.n <= this.lastSeq) return;                 // 古いスナップショットで位置や時計が戻らないようにする
      this.lastSeq = m.n;
      this.sync.sample(m.h);
      this._emitSnapshot(list);
    }
  }

  _startTimer() {
    this.timer = setInterval(() => this._tick(), 1000 / this.sendHz);
  }

  _tick() {
    const now = performance.now();
    const raw = this.o.getLocal?.();
    const mine = raw ? validState(packState(raw)) : null;
    if (this.isHost) {
      for (const p of [...this.peers.values()]) if (p.ready && now - p.lastSeen > PEER_TIMEOUT_MS) this._peerLost(p, true); // 無通信の相手を外す
      const list = [];
      if (mine) list.push({ id: this.id, s: mine });
      for (const p of this.peers.values()) if (p.state) list.push({ id: p.id, s: p.state });
      const msg = encode({ t: 'S', n: ++this.seq, h: Math.round((this.o.getTime?.() ?? 0) * 1000) / 1000, p: list.map((e) => [e.id, ...e.s]) });
      for (const p of this.peers.values()) if (p.ready && p.st.readyState === 'open' && p.st.bufferedAmount < 16384) p.st.send(msg);
      this._emitSnapshot(list);
    } else if (this.ready) {
      const h = this.peers.get(this.hostId);
      if (h && now - h.lastSeen > PEER_TIMEOUT_MS) { this._peerLost(h, true); return; } // ホストから何も届かない
      if (mine && h?.st.readyState === 'open') h.st.send(encode({ t: 's', n: ++this.seq, s: mine }));
    }
  }

  _peerLost(peer, failed = false) {
    if (!peer || peer.gone) return;
    peer.gone = true;
    clearTimeout(peer.timer);
    this.peers.delete(peer.id);
    try { peer.pc.close(); } catch (e) { /* 無視 */ }
    if (this.isHost) {
      if (this.players.delete(peer.id)) { this._broadcastCtl({ t: 'leave', id: peer.id }); this._emitPlayers(); }
    } else if (peer.id === this.hostId) this._end(failed ? 'p2p-failed' : 'host-left');
  }

  _end(reason, silent = false) {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer); clearInterval(this.pingTimer);
    if (reason === 'left') {
      // 自分から抜けるとき: 相手とDOに知らせる(切断の検出や猶予を待たせない)
      if (this.isHost) {
        this._broadcastCtl({ t: 'host-bye' });
        try { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'close' })); } catch (e) { /* 無視 */ }
      } else this._sendCtl(this.peers.get(this.hostId), { t: 'bye' });
    }
    const peers = [...this.peers.values()];
    this.peers.clear();
    const closePeers = () => { for (const p of peers) { clearTimeout(p.timer); try { p.pc.close(); } catch (e) { /* 無視 */ } } };
    if (reason === 'left') setTimeout(closePeers, 250); // 送った'bye'が届く前にチャネルを閉じない
    else closePeers();
    if (this.resumeWait) { const r = this.resumeWait; this.resumeWait = null; r(false); }
    try { this.ws?.close(1000); } catch (e) { /* 無視 */ }
    if (!silent) this.o.onClosed?.(reason);
  }
}

// P2Pマルチプレイのセッション(ブラウザ専用)。Host型Star: ホストが全員とWebRTCでつながり、状態を中継する。
// Durable Object(worker/index.js の Room)はシグナリングと参加・退出の通知だけ。ゲームのデータは流さない。
// 初期版: ホストが抜けたらRoom終了(ホスト交代なし)。他プレイヤーの移動は各自が計算して送る(位置の表示と世界時刻の同期まで)。
import { CONFIG } from '../config.js';
import { ICE_SERVERS, DEFAULT_SEND_HZ, encode, decode, cleanName, packState, validState, validSnapshot, validPlayers } from './protocol.js';

const base = () => CONFIG.apiBase.replace(/\/+$/, '');
const P2P_TIMEOUT_MS = 15000;

async function roomRequest(path, options) {
  if (!base()) throw new Error('API_NOT_CONFIGURED');
  const res = await fetch(base() + path, options);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((body && body.error) || 'HTTP_' + res.status);
    err.status = res.status;
    throw err;
  }
  return body;
}

/** ルームを作る。{ roomId } を返す(roomId = 6文字のコード) */
export const createRoom = (serverId) => roomRequest('/api/rooms', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ serverId })
});
/** ルームの情報。{ serverId, status, players, max } */
export const getRoomInfo = (code) => roomRequest(`/api/rooms/${code}/info`);

const wsUrl = (code, name, asHost) => base().replace(/^http/, 'ws') + `/api/rooms/${code}/ws?name=${encodeURIComponent(name)}${asHost ? '&host=1' : ''}`;

export class NetSession {
  /**
   * @param o { code, name, asHost, sendHz, getLocal:()=>[x,y,z,heading,speed,grounded], getTime:()=>秒(ホストの世界時刻),
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
    this.clock = null; this.rtt = 0;
  }

  connect() {
    this._status('接続中…');
    const ws = new WebSocket(wsUrl(this.code, cleanName(this.o.name), this.o.asHost));
    this.ws = ws;
    ws.onmessage = (e) => this._onWs(e.data);
    ws.onerror = () => {};
    // ホストは常にDOと繋がっている必要がある。クライアントはP2Pが成立したら、DOが切れても続行する
    ws.onclose = () => { if (!this.closed && (this.isHost || !this.ready)) this._end('signal-lost'); };
  }

  leave() { this._end('left', true); }

  /** ホストの世界時刻(秒)の推定値。クライアントのみ。まだ分からなければ null */
  getNetTime() {
    return this.clock ? this.clock.h + (performance.now() - this.clock.at) / 1000 + this.rtt / 2000 : null;
  }

  _status(t) { this.o.onStatus?.(t); }
  _emitPlayers() { this.o.onPlayers?.([...this.players.values()]); }
  _emitSnapshot(list) {
    this.o.onSnapshot?.(list.filter((e) => e.id !== this.id).map((e) => ({ id: e.id, name: this.players.get(e.id)?.name || 'Player', s: e.s })));
  }
  _signal(to, data) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'signal', to, data })); }
  _sendCtl(peer, msg) { if (peer?.ctl.readyState === 'open') peer.ctl.send(encode(msg)); }
  _broadcastCtl(msg, exceptId) { for (const p of this.peers.values()) if (p.ready && p.id !== exceptId) this._sendCtl(p, msg); }

  _onWs(raw) {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hello') {
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
    else if (m.t === 'peer-leave' && this.isHost) this._peerLost(this.peers.get(String(m.id)));
    else if (m.t === 'signal') this._onSignal(String(m.from), m.data);
    else if (m.t === 'closed') this._end(m.reason === 'host-left' ? 'host-left' : 'closed');
  }

  _makePeer(id, name = '') {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    // 両側で同じidを指定して作る(negotiated)ので、offer/answerの順序に依存しない
    const ctl = pc.createDataChannel('ctl', { negotiated: true, id: 0 });
    const st = pc.createDataChannel('st', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 });
    const peer = { id, name, pc, ctl, st, pending: [], remoteSet: false, ready: false, gone: false, state: null, lastRx: 0, timer: null };
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
    if (this.peers.has(id)) return;
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
    if (this.isHost) {
      this.players.set(peer.id, { id: peer.id, name: peer.name });
      this._sendCtl(peer, { t: 'welcome', id: peer.id, players: [...this.players.values()], h: this.o.getTime?.() ?? 0 });
      this._broadcastCtl({ t: 'join', id: peer.id, name: peer.name }, peer.id);
      this._emitPlayers();
    }
  }

  _onCtl(peer, m) {
    if (!m) return;
    if (m.t === 'ping') { this._sendCtl(peer, { t: 'pong', c: m.c }); return; }
    if (this.isHost) return;
    if (m.t === 'welcome') {
      const list = validPlayers(m.players);
      if (!list) return;
      this.players = new Map(list.map((p) => [p.id, p]));
      this.ready = true;
      this._emitPlayers();
      this._startTimer();
      this.pingTimer = setInterval(() => this._sendCtl(this.peers.get(this.hostId), { t: 'ping', c: performance.now() }), 2000);
      this._status('参加しました');
      this.o.onReady?.(this);
    } else if (m.t === 'join' && typeof m.id === 'string' && this.players.size < 8) {
      this.players.set(m.id, { id: m.id, name: cleanName(m.name) }); this._emitPlayers();
    } else if (m.t === 'leave' && typeof m.id === 'string') {
      this.players.delete(m.id); this._emitPlayers();
    } else if (m.t === 'pong' && Number.isFinite(m.c)) {
      const rtt = performance.now() - m.c;
      this.rtt = this.rtt ? this.rtt * 0.7 + rtt * 0.3 : rtt;
    }
  }

  _onSt(peer, m) {
    if (!m) return;
    if (this.isHost) {
      if (m.t !== 's') return;
      const now = performance.now();
      if (now - peer.lastRx < 1000 / (this.sendHz * 4)) return; // 送りすぎは捨てる
      const s = validState(m.s);
      if (s) { peer.lastRx = now; peer.state = s; }
    } else if (m.t === 'S') {
      const list = validSnapshot(m);
      if (!list) return;
      this.clock = { h: m.h, at: performance.now() };
      this._emitSnapshot(list);
    }
  }

  _startTimer() {
    this.timer = setInterval(() => this._tick(), 1000 / this.sendHz);
  }

  _tick() {
    const raw = this.o.getLocal?.();
    const mine = raw ? validState(packState(raw)) : null;
    if (this.isHost) {
      const list = [];
      if (mine) list.push({ id: this.id, s: mine });
      for (const p of this.peers.values()) if (p.state) list.push({ id: p.id, s: p.state });
      const msg = encode({ t: 'S', h: Math.round((this.o.getTime?.() ?? 0) * 1000) / 1000, p: list.map((e) => [e.id, ...e.s]) });
      for (const p of this.peers.values()) if (p.ready && p.st.readyState === 'open' && p.st.bufferedAmount < 16384) p.st.send(msg);
      this._emitSnapshot(list);
    } else if (this.ready && mine) {
      const h = this.peers.get(this.hostId);
      if (h?.st.readyState === 'open') h.st.send(encode({ t: 's', s: mine }));
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
    for (const p of this.peers.values()) { clearTimeout(p.timer); try { p.pc.close(); } catch (e) { /* 無視 */ } }
    this.peers.clear();
    try { this.ws?.close(1000); } catch (e) { /* 無視 */ }
    if (!silent) this.o.onClosed?.(reason);
  }
}

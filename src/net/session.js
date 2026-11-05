// P2Pマルチプレイのセッション(ブラウザ専用)。ホストレス・フルメッシュ: 全員が対等で、お互いに直接WebRTCでつながる。
// Durable Object(worker/index.js の Room)は、参加・退出の通知・SDP/ICEの中継・世界時刻の基準だけ。ゲームのデータは流さない。
// - 接続の向き: 後から入った人は待つだけ。先にいた人が「新しい人」へofferを出す(両側が同時に出すことがない)。
// - 位置は各自が計算して、16バイトのバイナリ(protocol.encodeState)で全員へ送る。受け取った側が補間して表示する。
// - シグナリングのWebSocketが切れても、つながっている相手とのP2Pは続く。裏で再接続して(Roomが猶予を持つ)、新しい参加者も迎える。
// - P2Pが切れた相手とは、続けて張り直す(間隔を広げて数回)。offerを出すのは常に先に入った側なので、後から入った側は
//   シグナリングで「もう一度offerを出して」と頼む({retry:true})。再接続した人はRoomが peer-back で全員に知らせる。
// - ゲームの内容(スクリプトの結果・HP・スコア)は同期しない。ホストがいないので、いまは位置と向きだけ。
import { CONFIG } from '../config.js';
import {
  ICE_SERVERS, DEFAULT_SEND_HZ, MAX_PLAYERS, PEER_TIMEOUT_MS, CTL_MAX_PER_SEC, IDLE_HEARTBEAT_MS,
  STATE_BODY_OFFSET, encode, decode, cleanName, encodeState, decodeState, seqNewer, validPlayers, joinOrder
} from './protocol.js';
import { ServerClock } from './clock.js';

const base = () => CONFIG.apiBase.replace(/\/+$/, '');
const P2P_TIMEOUT_MS = 15000;
const WS_RECONNECT_MS = 40000;     // Room側の猶予(45秒)より短くする
const READY_FALLBACK_MS = 3000;    // 時計の最初の返事がこなくても、これだけ待てば参加済みにする
const CLOCK_BURST = 4;             // 参加時に時計を合わせる往復の回数
const CLOCK_BURST_GAP_MS = 150;
const CLOCK_RESYNC_MS = 600000;    // その後は10分ごとに1回だけ合わせ直す(端末ごとの時計の進み方の違い。DOを起こす回数を減らすため間引く)
const CLOCK_RESYNC_BURST = 1;
const PEER_CLOCK_SYNC_MS = 60000; // Roomを起こさず、ctlで1分ごとに時計を照合
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000]; // 切れたP2Pを張り直す間隔(全部で約30秒。それでもだめなら諦める)
const RETRY_GUARD_MS = 3000;       // 作ったばかりの接続は、再試行の依頼で作り直さない
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

/** ルームを作る。{ roomId } を返す(roomId = 6文字のコード) */
export const createRoom = (serverId) => roomRequest('/api/rooms', {
  method: 'POST',
  // 管理用の合言葉を設定している人は、作成の回数制限を受けない(開発・検証用)
  headers: { 'Content-Type': 'application/json', ...(CONFIG.adminPassphrase ? { Authorization: 'Bearer ' + CONFIG.adminPassphrase } : {}) },
  body: JSON.stringify({ serverId })
});
/** ルームの情報。{ serverId, status, players, max } */
export const getRoomInfo = (code) => roomRequest(`/api/rooms/${code}/info`);

const wsUrl = (code, name, resume) => base().replace(/^http/, 'ws')
  + `/api/rooms/${code}/ws?name=${encodeURIComponent(name)}${resume ? `&id=${encodeURIComponent(resume.id)}&token=${encodeURIComponent(resume.token)}` : ''}`;

export class NetSession {
  /**
   * @param o { code, name, sendHz, getLocal:()=>[x,y,z,heading,speed,grounded],
   *            onStatus(text), onReady(session), onPlayers([{id,name}]), onSnapshot([{id,name,s}]), onClosed(reason) }
   *   onSnapshot は送信と同じ間隔で、いま見えている他のプレイヤー全員の最新の位置を渡す(載っていない人は消えた人)。
   */
  constructor(o) {
    this.o = o;
    this.code = o.code;
    this.sendHz = Math.min(30, Math.max(5, Number(o.sendHz) || DEFAULT_SEND_HZ));
    this.ws = null;
    this.id = ''; this.token = ''; this.ready = false; this.closed = false;
    this.known = new Map();  // Roomが知っている、自分以外の参加者 id → name
    this.peers = new Map();  // WebRTCの相手 id → peer
    this.clock = new ServerClock();
    this.timer = null; this.clockTimer = null; this.peerClockTimer = null; this.readyTimer = null;
    this.seq = 0;
    this.lastBody = null; this.lastSentAt = 0;
    this.resumeWait = null; this.reconnecting = false;
    this.retries = new Map(); // 切れた相手 id → { n:試した回数, timer }
  }

  connect() {
    this._status('接続中…');
    this._openWs(null);
  }

  leave() { this._end('left', true); }

  /** 世界時刻(秒)の推定値。まだ分からなければ null */
  getNetTime() { return this.clock.time(); }

  /** 自分を含む、いま確認できている参加者 [{id,name}] */
  playerList() {
    const list = [{ id: this.id, name: cleanName(this.o.name) }];
    for (const p of this.peers.values()) if (p.ready) list.push({ id: p.id, name: p.name });
    return list;
  }

  _status(t) { this.o.onStatus?.(t); }
  _emitPlayers() { if (this.ready && !this.closed) this.o.onPlayers?.(this.playerList()); }
  _signal(to, data) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'signal', to, data })); }
  _sendCtl(peer, msg) { if (peer?.ctl.readyState === 'open') peer.ctl.send(encode(msg)); }

  // ICE候補は最大5件、または50msごとにまとめてRoomへ送る。
  _flushIceCandidates(peer) {
    if (!peer || peer.gone || !peer.iceQueue?.length) return;
    clearTimeout(peer.iceFlushTimer);
    peer.iceFlushTimer = null;
    const candidates = peer.iceQueue.splice(0, 5);
    this._signal(peer.id, { cs: candidates });
    if (peer.iceQueue.length) peer.iceFlushTimer = setTimeout(() => this._flushIceCandidates(peer), 50);
  }

  // ── Room(シグナリング)とのWebSocket ──
  _openWs(resume) {
    const ws = new WebSocket(wsUrl(this.code, cleanName(this.o.name), resume));
    this.ws = ws;
    ws.onmessage = (e) => { if (this.ws === ws) this._onWs(e.data); };
    ws.onerror = () => {};
    ws.onclose = () => { if (this.ws === ws && !this.closed) this._onWsClosed(); };
  }

  // 参加前に切れたら失敗。参加後は、P2Pはそのまま続けて、裏で再接続する
  _onWsClosed() {
    if (this.resumeWait) { const r = this.resumeWait; this.resumeWait = null; r(false); return; }
    if (!this.ready) this._end('signal-lost');
    else this._reconnectWs();
  }

  async _reconnectWs() {
    if (this.reconnecting) return;
    this.reconnecting = true;
    const deadline = performance.now() + WS_RECONNECT_MS;
    let delay = 500;
    while (!this.closed && performance.now() < deadline) {
      await sleep(delay);
      delay = Math.min(delay * 2, 5000);
      if (this.closed) return;
      try { await getRoomInfo(this.code); } catch (e) { if (e.status === 404) break; } // Roomが無くなっていたら諦める
      const ok = await new Promise((resolve) => { this.resumeWait = resolve; this._openWs({ id: this.id, token: this.token }); });
      if (ok) { this.reconnecting = false; return; }
    }
    this.reconnecting = false;
    if (!this.closed) this._status('サーバーとの接続が切れました(いまいる人とは続けられますが、新しい参加者は迎えられません)');
  }

  _onWs(raw) {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hello') {
      if (m.resumed && this.ready) { this._onResumed(m); return; }
      this.id = String(m.id); this.token = String(m.token || '');
      this.known = new Map((validPlayers(m.peers) || []).map((p) => [p.id, p.name]));
      this._status('他のプレイヤーと通信を準備中…');
      this._startClockSync();
      this.readyTimer = setTimeout(() => this._becomeReady(), READY_FALLBACK_MS);
    } else if (m.t === 'peer-join') {
      const id = String(m.id); const name = cleanName(m.name);
      if (id === this.id) return;
      this.known.set(id, name);
      this._offerTo(id, name); // 後から入った人へ、先にいた人からofferを出す
    } else if (m.t === 'peer-leave') {
      const id = String(m.id);
      this.known.delete(id);
      this._clearRetry(id);
      const p = this.peers.get(id);
      if (p && !p.ready) this._peerLost(p, false, true); // 接続が成立済みの相手は、P2Pが生きていれば続ける
    } else if (m.t === 'peer-back') {
      // 相手のシグナリングだけが切れていて、戻ってきた。P2Pが切れていれば張り直す
      const id = String(m.id);
      if (id === this.id || !/^p\d{1,9}$/.test(id)) return;
      this.known.set(id, cleanName(m.name));
      this._clearRetry(id);
      this._ensureLink(id);
      this._scheduleRetry(id);
    } else if (m.t === 'signal') this._onSignal(String(m.from), m.data);
    else if (m.t === 'time') {
      if (Number.isFinite(m.c) && Number.isFinite(m.s)) {
        const firstSample = !this.clock.has();
        this.clock.sample(m.c, m.s);
        if (firstSample) this._syncPeerClocks();
        this._becomeReady();
      }
    }
    else if (m.t === 'closed') this._end('closed');
  }

  // 再接続できた。留守の間に入った人(自分より後に入った人)へofferを出し、消えた人の接続途中の分を片付ける
  _onResumed(m) {
    const list = validPlayers(m.peers) || [];
    const ids = new Set(list.map((p) => p.id));
    this.known = new Map(list.map((p) => [p.id, p.name]));
    for (const peer of [...this.peers.values()]) if (!ids.has(peer.id)) this._peerLost(peer, false, true); // Roomにいない相手は片付ける
    for (const p of list) { this._clearRetry(p.id); this._ensureLink(p.id); this._scheduleRetry(p.id); } // 留守の間に入った人・切れていた人とつなぐ
    const r = this.resumeWait; this.resumeWait = null; r?.(true);
  }

  // ── 世界時刻 ──
  _pingClock() { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'time', c: performance.now() })); }
  _burstClock(n) { for (let i = 0; i < n; i++) setTimeout(() => { if (!this.closed) this._pingClock(); }, i * CLOCK_BURST_GAP_MS); }
  _startClockSync() {
    this._burstClock(CLOCK_BURST);
    clearInterval(this.clockTimer);
    this.clockTimer = setInterval(() => this._burstClock(CLOCK_RESYNC_BURST), CLOCK_RESYNC_MS);
    clearInterval(this.peerClockTimer);
    this.peerClockTimer = setInterval(() => this._syncPeerClocks(), PEER_CLOCK_SYNC_MS);
  }

  // ctlでPeerへ問い合わせる。応答側はRoom由来の推定だけを返すため、Peer間で誤差が連鎖しない。
  _pingPeerClock(peer) {
    if (peer?.ready && this.clock.has()) this._sendCtl(peer, { t: 'clock-ping', c: performance.now() });
  }

  _syncPeerClocks() {
    if (!this.clock.has()) return;
    for (const peer of this.peers.values()) this._pingPeerClock(peer);
  }

  _becomeReady() {
    if (this.ready || this.closed || !this.id) return;
    clearTimeout(this.readyTimer);
    this.ready = true;
    this.timer = setInterval(() => this._tick(), 1000 / this.sendHz);
    this._status('参加しました');
    this.o.onReady?.(this);
    this._emitPlayers();
  }

  // ── WebRTC ──
  _makePeer(id, name) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    // 両側で同じidを指定して作る(negotiated)ので、offer/answerの順序に依存しない
    const ctl = pc.createDataChannel('ctl', { negotiated: true, id: 0 });
    const st = pc.createDataChannel('st', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 });
    st.binaryType = 'arraybuffer';
    const now = performance.now();
    const peer = { id, name, pc, ctl, st, pending: [], iceQueue: [], iceFlushTimer: null, remoteSet: false, ready: false, gone: false, state: null, lastRx: 0, rxSeq: -1, lastSeen: now, ctlWindow: now, ctlCount: 0, timer: null, created: now };
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        peer.iceQueue.push(e.candidate.toJSON());
        if (peer.iceQueue.length >= 5) this._flushIceCandidates(peer);
        else if (!peer.iceFlushTimer) peer.iceFlushTimer = setTimeout(() => this._flushIceCandidates(peer), 50);
      } else this._flushIceCandidates(peer); // ICE gathering完了時に残りを送る
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this._peerLost(peer, true); };
    ctl.onopen = () => this._onCtlOpen(peer);
    ctl.onclose = () => this._peerLost(peer);
    ctl.onmessage = (e) => this._onCtl(peer, decode(e.data));
    st.onmessage = (e) => this._onSt(peer, e.data);
    peer.timer = setTimeout(() => { if (!peer.ready) this._peerLost(peer, true); }, P2P_TIMEOUT_MS);
    this.peers.set(id, peer);
    return peer;
  }

  // 自分より後に入った相手にだけofferを出す(順番の小さいほうが出す)
  async _offerTo(id, name) {
    if (this.peers.has(id) || this.peers.size >= MAX_PLAYERS - 1) return;
    if (!(joinOrder(id) > joinOrder(this.id))) return;
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
        if (data.sdp.type === 'offer') {
          // offerを受けるのは、自分より先に入っていて、Roomが参加者として教えてくれた(または接続済みの)相手だけ
          if ((!this.known.has(from) && !peer) || !(joinOrder(from) < joinOrder(this.id))) return;
          if (peer) { this._peerLost(peer, false, true); peer = null; } // 切れたことに気づく前に、相手が張り直しに来た
          if (this.peers.size >= MAX_PLAYERS - 1) return;
          peer = this._makePeer(from, this.known.get(from) || 'Player');
        } else if (!peer) return;
        await peer.pc.setRemoteDescription({ type: data.sdp.type, sdp: data.sdp.sdp });
        peer.remoteSet = true;
        for (const c of peer.pending.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
        if (data.sdp.type === 'offer') {
          await peer.pc.setLocalDescription(await peer.pc.createAnswer());
          const d = peer.pc.localDescription;
          this._signal(from, { sdp: { type: d.type, sdp: d.sdp } });
        }
      } else if (data.retry === true) {
        // 後から入った相手から「もう一度offerを出して」と頼まれた
        if (!this.known.has(from) || !(joinOrder(from) > joinOrder(this.id))) return;
        if (peer && performance.now() - peer.created < RETRY_GUARD_MS) return; // 張り直している最中
        if (peer) this._peerLost(peer, false, true);
        this._offerTo(from, this.known.get(from));
      } else if (Array.isArray(data.cs) && peer) {
        for (const candidate of data.cs.slice(0, 5)) {
          if (!candidate || typeof candidate !== 'object') continue;
          if (peer.remoteSet) await peer.pc.addIceCandidate(candidate).catch(() => {});
          else if (peer.pending.length < 64) peer.pending.push(candidate);
        }
      } else if (data.c && peer) { // 古いクライアントからの単独候補も受け付ける
        if (peer.remoteSet) await peer.pc.addIceCandidate(data.c).catch(() => {});
        else if (peer.pending.length < 64) peer.pending.push(data.c);
      }
    } catch (e) { this._peerLost(peer, true); }
  }

  _onCtlOpen(peer) {
    clearTimeout(peer.timer);
    this._clearRetry(peer.id);
    peer.ready = true;
    peer.lastSeen = performance.now();
    this._pingPeerClock(peer);
    this._emitPlayers();
  }

  _onCtl(peer, m) {
    if (!m) return;
    const now = performance.now();
    peer.lastSeen = now;
    if (now - peer.ctlWindow > 1000) { peer.ctlWindow = now; peer.ctlCount = 0; }
    if (++peer.ctlCount > CTL_MAX_PER_SEC) return; // 制御メッセージの送りすぎは捨てる
    if (m.t === 'bye') this._peerLost(peer, false, true);       // 相手が自分から抜けた(切断の検出を待たずに済む)
    else if (m.t === 'clock-ping') {
      if (Number.isFinite(m.c) && this.clock.has()) {
        this._sendCtl(peer, { t: 'clock-pong', c: m.c, s: this.clock.roomTime(), u: this.clock.roomUncertainty() });
      }
    } else if (m.t === 'clock-pong') {
      if (Number.isFinite(m.c) && Number.isFinite(m.s) && Number.isFinite(m.u)) this.clock.samplePeer(m.c, m.s, m.u);
    }
  }

  _onSt(peer, data) {
    const d = decodeState(data);
    if (!d) return;
    const now = performance.now();
    peer.lastSeen = now;
    if (now - peer.lastRx < 1000 / (this.sendHz * 4)) return;      // 送りすぎは捨てる
    if (peer.rxSeq >= 0 && !seqNewer(d.seq, peer.rxSeq)) return;   // 順序が入れ替わった古い状態は使わない
    peer.lastRx = now; peer.rxSeq = d.seq; peer.state = d.s;
  }

  _tick() {
    const now = performance.now();
    for (const p of [...this.peers.values()]) if (p.ready && now - p.lastSeen > PEER_TIMEOUT_MS) this._peerLost(p, true); // 無通信の相手を外す

    // 自分の状態を全員へ。止まっている間は間隔を空ける(動いたらすぐ送る)
    const pkt = encodeState(this.seq, this.o.getLocal?.());
    if (pkt) {
      const body = new Uint8Array(pkt, STATE_BODY_OFFSET);
      const same = this.lastBody && body.every((b, i) => b === this.lastBody[i]);
      if (!same || now - this.lastSentAt >= IDLE_HEARTBEAT_MS) {
        this.seq = (this.seq + 1) & 0xffff;
        this.lastBody = body.slice(); this.lastSentAt = now;
        for (const p of this.peers.values()) if (p.ready && p.st.readyState === 'open' && p.st.bufferedAmount < 16384) p.st.send(pkt);
      }
    }

    const list = [];
    for (const p of this.peers.values()) if (p.ready && p.state) list.push({ id: p.id, name: p.name, s: p.state });
    this.o.onSnapshot?.(list);
  }

  // final: 相手が自分から抜けた・Roomからいなくなった・こちらから作り直す、など。張り直しはしない
  _peerLost(peer, failed = false, final = false) {
    if (!peer || peer.gone) return;
    peer.gone = true;
    clearTimeout(peer.timer);
    clearTimeout(peer.iceFlushTimer);
    peer.iceQueue.length = 0;
    const wasReady = peer.ready;
    this.peers.delete(peer.id);
    try { peer.pc.close(); } catch (e) { /* 無視 */ }
    if (wasReady) this._emitPlayers();
    if (!final && !this.closed) this._scheduleRetry(peer.id);
  }

  // ── 切れたP2Pの張り直し ──
  // 相手とのP2Pを用意する。offerを出すのは先に入った側。後から入った側は、先に入った側へ出し直しを頼む
  _ensureLink(id) {
    if (this.closed || !this.known.has(id)) return;
    const p = this.peers.get(id);
    if (p) {
      if (p.ready || performance.now() - p.created < P2P_TIMEOUT_MS) return; // つながっている/つなぎ中
      this._peerLost(p, false, true);
    }
    if (joinOrder(id) > joinOrder(this.id)) this._offerTo(id, this.known.get(id));
    else this._signal(id, { retry: true });
  }

  _clearRetry(id) {
    const r = this.retries.get(id);
    if (r) { clearTimeout(r.timer); this.retries.delete(id); }
  }

  _scheduleRetry(id) {
    if (this.closed || !this.known.has(id) || this.peers.get(id)?.ready) return;
    let r = this.retries.get(id);
    if (!r) { r = { n: 0, timer: null }; this.retries.set(id, r); }
    if (r.timer) return;
    if (r.n >= RETRY_DELAYS_MS.length) {
      // 回線の都合などで直接つながらない。他の相手とは続けられる
      this.retries.delete(id);
      this._status('直接つながらなかった相手がいます(回線の都合の可能性があります)');
      return;
    }
    r.timer = setTimeout(() => { r.timer = null; this._retryNow(id); }, RETRY_DELAYS_MS[r.n]);
  }

  _retryNow(id) {
    const r = this.retries.get(id);
    if (!r || this.closed) return;
    if (!this.known.has(id) || this.peers.get(id)?.ready) { this.retries.delete(id); return; }
    if (this.ws?.readyState !== 1) { r.timer = setTimeout(() => { r.timer = null; this._retryNow(id); }, 1000); return; } // シグナリングが戻るまで待つ(回数に数えない)
    r.n++;
    this._ensureLink(id);
    this._scheduleRetry(id);
  }

  _end(reason, silent = false) {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer); clearInterval(this.clockTimer); clearInterval(this.peerClockTimer); clearTimeout(this.readyTimer);
    for (const r of this.retries.values()) clearTimeout(r.timer);
    this.retries.clear();
    const peers = [...this.peers.values()];
    // 自分から抜けるとき: 相手に知らせる(切断の検出を待たせない)
    if (reason === 'left') for (const p of peers) this._sendCtl(p, { t: 'bye' });
    this.peers.clear();
    const closePeers = () => { for (const p of peers) { clearTimeout(p.timer); clearTimeout(p.iceFlushTimer); p.iceQueue.length = 0; try { p.pc.close(); } catch (e) { /* 無視 */ } } };
    if (reason === 'left') setTimeout(closePeers, 250); // 送った'bye'が届く前にチャネルを閉じない
    else closePeers();
    if (this.resumeWait) { const r = this.resumeWait; this.resumeWait = null; r(false); }
    try { this.ws?.close(1000); } catch (e) { /* 無視 */ }
    if (!silent) this.o.onClosed?.(reason);
  }
}

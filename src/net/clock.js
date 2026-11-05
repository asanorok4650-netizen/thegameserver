// 全員で揃える世界時刻の時計。THREE・ブラウザ非依存なのでNodeでテストできる。
// ホストがいないので、基準は Room(Durable Object)の時計。世界時刻 = 「Room を作ってからの経過秒」。
// - 参加時に数回(その後も時々)、Room へ「送信時刻 c」を送って「そのときのRoomの世界時刻 s」を返してもらう。
// - 往復時間(rtt)が最小のサンプルを信用する(行きと帰りの遅れが同じくらいだと見なせるのは、速く往復できたとき)。
//   そのときの Room の時刻は、送信と受信のちょうど真ん中 (c + rtt/2) の時点だと考える。
// - 小さなずれはなだらかに寄せ、大きなずれ(snapMs以上)は一度で合わせる。
// - P2PではRoom由来の推定値だけを共有する。Peer経由の推定値を再共有せず、誤差の連鎖を防ぐ。
export class ServerClock {
  /** @param o { now:()=>ミリ秒, keep:信用するサンプルの数, snapMs, gain } */
  constructor(o = {}) {
    this.now = o.now || (() => performance.now());
    this.keep = o.keep ?? 8;
    this.snapMs = o.snapMs ?? 500;
    this.gain = o.gain ?? 0.2;
    this.samples = []; // { rtt, offset, at }。新しい順に keep 個
    this.offset = null; // Roomから直接得た世界時刻のoffset
    this.peerOffset = null; // ctlで受け取った、Room由来のPeer推定値
    this.peerUncertainty = Infinity;
    this.peerAt = 0;
  }

  /** @param sentAt 送ったときの自分の時計(ミリ秒) @param serverTime 返事に載っていたRoomの世界時刻(秒) */
  sample(sentAt, serverTime) {
    if (!Number.isFinite(sentAt) || !Number.isFinite(serverTime)) return;
    const rtt = this.now() - sentAt;
    if (!(rtt >= 0)) return;
    const now = this.now();
    this.samples.unshift({ rtt, offset: serverTime - (sentAt + rtt / 2) / 1000, at: now });
    if (this.samples.length > this.keep) this.samples.length = this.keep;
    let best = this.samples[0];
    for (const x of this.samples) if (x.rtt < best.rtt) best = x;
    if (this.offset === null || Math.abs(best.offset - this.offset) * 1000 > this.snapMs) this.offset = best.offset;
    else this.offset += (best.offset - this.offset) * this.gain;
  }

  has() { return this.offset !== null; }

  /** Roomから直接得た世界時刻。Peerへ共有するときはこちらだけを使う */
  roomTime() { return this.offset === null ? null : this.now() / 1000 + this.offset; }

  /** Roomサンプルの不確実性(秒)。経過時間に応じて端末時計のドリフト分を加える */
  roomUncertainty() {
    if (!this.samples.length) return Infinity;
    const best = this.samples.reduce((a, b) => b.rtt < a.rtt ? b : a);
    return best.rtt / 2000 + Math.max(0, this.now() - best.at) / 1000 * 0.00005;
  }

  /** Peerの応答を採用する。Peer由来の値はroomTime()に反映せず、再共有しない */
  samplePeer(sentAt, roomTime, sourceUncertainty = 0) {
    if (!Number.isFinite(sentAt) || !Number.isFinite(roomTime) || !Number.isFinite(sourceUncertainty) || sourceUncertainty < 0 || sourceUncertainty > 10) return;
    const now = this.now();
    const rtt = now - sentAt;
    if (rtt < 0 || rtt > 5000) return;
    const uncertainty = rtt / 2000 + sourceUncertainty;
    if (uncertainty < this.peerUncertainty || now - this.peerAt > 120000) {
      this.peerOffset = roomTime - (sentAt + rtt / 2) / 1000;
      this.peerUncertainty = uncertainty;
      this.peerAt = now;
    }
  }

  /** 世界時刻(秒)の推定値。新鮮でより確かなPeer推定があれば使う */
  time() {
    if (this.offset === null) return null;
    const now = this.now();
    const peerUncertainty = this.peerUncertainty + Math.max(0, now - this.peerAt) / 1000 * 0.00005;
    const usePeer = this.peerOffset !== null && now - this.peerAt <= 120000 && peerUncertainty < this.roomUncertainty();
    return now / 1000 + (usePeer ? this.peerOffset : this.offset);
  }
}

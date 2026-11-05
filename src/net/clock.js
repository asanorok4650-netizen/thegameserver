// 全員で揃える世界時刻の時計。THREE・ブラウザ非依存なのでNodeでテストできる。
// ホストがいないので、基準は Room(Durable Object)の時計。世界時刻 = 「Room を作ってからの経過秒」。
// - 参加時に数回(その後も時々)、Room へ「送信時刻 c」を送って「そのときのRoomの世界時刻 s」を返してもらう。
// - 往復時間(rtt)が最小のサンプルを信用する(行きと帰りの遅れが同じくらいだと見なせるのは、速く往復できたとき)。
//   そのときの Room の時刻は、送信と受信のちょうど真ん中 (c + rtt/2) の時点だと考える。
// - 小さなずれはなだらかに寄せ、大きなずれ(snapMs以上)は一度で合わせる。
export class ServerClock {
  /** @param o { now:()=>ミリ秒, keep:信用するサンプルの数, snapMs, gain } */
  constructor(o = {}) {
    this.now = o.now || (() => performance.now());
    this.keep = o.keep ?? 8;
    this.snapMs = o.snapMs ?? 500;
    this.gain = o.gain ?? 0.2;
    this.samples = []; // { rtt, offset }。新しい順に keep 個
    this.offset = null; // 世界時刻(秒) = 自分の時計(秒) + offset
  }

  /** @param sentAt 送ったときの自分の時計(ミリ秒) @param serverTime 返事に載っていたRoomの世界時刻(秒) */
  sample(sentAt, serverTime) {
    if (!Number.isFinite(sentAt) || !Number.isFinite(serverTime)) return;
    const rtt = this.now() - sentAt;
    if (!(rtt >= 0)) return;
    this.samples.unshift({ rtt, offset: serverTime - (sentAt + rtt / 2) / 1000 });
    if (this.samples.length > this.keep) this.samples.length = this.keep;
    let best = this.samples[0];
    for (const x of this.samples) if (x.rtt < best.rtt) best = x;
    if (this.offset === null || Math.abs(best.offset - this.offset) * 1000 > this.snapMs) this.offset = best.offset;
    else this.offset += (best.offset - this.offset) * this.gain;
  }

  has() { return this.offset !== null; }

  /** 世界時刻(秒)の推定値。まだ分からなければ null */
  time() { return this.offset === null ? null : this.now() / 1000 + this.offset; }
}

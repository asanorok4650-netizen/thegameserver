// ホストの世界時刻に合わせるための時計(クライアント用)。THREE・ブラウザ非依存なのでNodeでテストできる。
// - 世界時刻は「ホストの performance.now 基準の経過秒」。フレームのdtには依存しない。
// - スナップショットが届くたびに「ホスト時刻 - 自分の時刻」のずれを推定し、直近windowMsの中で最も遅延の少なかった
//   サンプル(=ずれが最大のもの)を採用する。ネットワークの揺れで時計がぶれにくい。
// - 小さなずれはなだらかに寄せ、大きなずれ(snapMs以上)は一度で合わせる。
export class ClockSync {
  /** @param o { now:()=>ミリ秒, windowMs, snapMs, gain } */
  constructor(o = {}) {
    this.now = o.now || (() => performance.now());
    this.windowMs = o.windowMs ?? 5000;
    this.snapMs = o.snapMs ?? 500;
    this.gain = o.gain ?? 0.2;
    this.samples = [];   // { at:ミリ秒, s:秒 }
    this.offset = null;  // ホスト時刻 = 自分の時刻(秒) + offset
    this.rttMs = 0;
  }

  setRtt(ms) { if (Number.isFinite(ms) && ms >= 0) this.rttMs = ms; }

  /** ホストの時刻h(秒)を載せたパケットを受け取ったとき */
  sample(h) {
    if (!Number.isFinite(h)) return;
    const now = this.now();
    this.samples.push({ at: now, s: h - now / 1000 });
    while (this.samples.length && now - this.samples[0].at > this.windowMs) this.samples.shift();
    let best = -Infinity;
    for (const x of this.samples) if (x.s > best) best = x.s;
    const target = best + this.rttMs / 2000; // 最小遅延のパケットでも片道ぶんは古い
    if (this.offset === null || Math.abs(target - this.offset) * 1000 > this.snapMs) this.offset = target;
    else this.offset += (target - this.offset) * this.gain;
  }

  has() { return this.offset !== null; }

  /** ホストの世界時刻(秒)の推定値。まだ分からなければ null */
  time() { return this.offset === null ? null : this.now() / 1000 + this.offset; }
}

// 世界時刻の同期(ServerClock)のテスト
import assert from 'node:assert/strict';
import { ServerClock } from '../src/net/clock.js';

let nowMs = 100000;
const mk = (o) => new ServerClock({ now: () => nowMs, ...o });
const roomAt = (ms) => 5000 + (ms - 100000) / 1000; // Roomの世界時刻(秒)。自分の時計と同じ速さで進む

// 試す関数: 片道 up ミリ秒で届き、返事は down ミリ秒で戻る。返事を受け取った時点で sample を呼ぶ
function ping(c, up, down) {
  const sentAt = nowMs;
  const s = roomAt(sentAt + up); // Roomが返事を作った時刻の世界時刻
  nowMs += up + down;
  c.sample(sentAt, s);
}

// まだサンプルがなければ null
{ const c = mk(); assert.equal(c.time(), null); assert.equal(c.has(), false); }

// 行きと帰りが同じ遅れなら、ほぼ正確に合う。時間が進めば同じだけ進む
{
  const c = mk();
  ping(c, 30, 30);
  assert.ok(Math.abs(c.time() - roomAt(nowMs)) < 1e-9);
  nowMs += 3000;
  assert.ok(Math.abs(c.time() - roomAt(nowMs)) < 1e-9);
}

// 揺れ: 往復が 40〜400ms で変わっても、最小往復(40ms)のサンプルに寄る
{
  nowMs = 100000;
  const c = mk();
  for (const d of [200, 40, 120, 20, 180, 90]) { ping(c, d, d); nowMs += 100; }
  assert.ok(Math.abs(c.time() - roomAt(nowMs)) < 1e-9, '対称な往復なら最小往復のサンプルで正確');
  const before = c.time() - roomAt(nowMs);
  ping(c, 400, 400); // 遅い往復が来ても時計は乱れない
  assert.ok(Math.abs(c.time() - roomAt(nowMs) - before) < 1e-9);
}

// 行きと帰りが非対称でも、誤差は往復の差の半分まで
{
  nowMs = 100000;
  const c = mk();
  ping(c, 10, 50); // 片道が違う(往復60ms)
  assert.ok(Math.abs(c.time() - roomAt(nowMs)) <= 0.021, '誤差は (50-10)/2 = 20ms 以内');
}

// 大きなずれは一度で合わせ、小さなずれはなだらかに寄せる
{
  nowMs = 100000;
  const c = mk({ keep: 1 });
  ping(c, 10, 10);
  const t0 = c.time();
  const sentAt = nowMs; nowMs += 20;
  c.sample(sentAt, roomAt(sentAt + 10) + 0.05); // Roomの時計が50ms進んでいた
  assert.ok(c.time() > t0 && c.time() < t0 + 0.05 + 0.03, 'なだらかに寄る');
  const s2 = nowMs; nowMs += 20;
  c.sample(s2, roomAt(s2 + 10) + 490); // 490秒ずれ
  assert.ok(Math.abs(c.time() - (roomAt(nowMs) + 490)) < 1e-6, '大きなずれは一度で合わせる');
}

// 不正な値は無視(負の往復=時計が戻った、も含む)
{
  nowMs = 100000;
  const c = mk(); c.sample(NaN, 1); c.sample(1, Infinity); c.sample(nowMs + 1000, 1);
  assert.equal(c.time(), null);
}
// P2Pの時計推定はRoom基準の推定だけを共有し、Peer由来の値を再共有しない。
{
  nowMs = 100000;
  const c = mk();
  ping(c, 100, 100); // Room直通は往復200ms
  const roomBefore = c.roomTime();
  const sentAt = nowMs;
  nowMs += 20;
  c.samplePeer(sentAt, roomAt(sentAt + 10) + 0.001, 0.005); // Peer側のRoom推定誤差5ms
  assert.ok(c.peerAt === nowMs, 'Peerサンプルを記録');
  assert.ok(Math.abs(c.time() - (roomAt(nowMs) + 0.001)) < 1e-6, 'より確かなPeer推定を利用');
  assert.ok(Math.abs(c.roomTime() - roomBefore - 0.02) < 1e-9, 'Peer推定でRoom基準を上書きしない');
  nowMs += 121000;
  assert.ok(Math.abs(c.time() - c.roomTime()) < 1e-9, '古いPeer推定は使わずRoom基準へ戻る');
}

console.log('net-clock: ok');

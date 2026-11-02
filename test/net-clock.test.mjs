// 世界時刻の同期(ClockSync)のテスト
import assert from 'node:assert/strict';
import { ClockSync } from '../src/net/clock.js';

let nowMs = 100000;
const mk = (o) => new ClockSync({ now: () => nowMs, ...o });

// まだサンプルがなければ null
{ const c = mk(); assert.equal(c.time(), null); assert.equal(c.has(), false); }

// 遅延なしなら、ホスト時刻にそのまま合う。時間が進めば同じだけ進む
{
  const c = mk();
  const hostAt = (ms) => 5000 + (ms - 100000) / 1000; // ホストの時計(秒)
  c.sample(hostAt(nowMs));
  assert.ok(Math.abs(c.time() - hostAt(nowMs)) < 1e-9);
  nowMs += 3000;
  assert.ok(Math.abs(c.time() - hostAt(nowMs)) < 1e-9);
}

// 揺れ: 遅延が 20〜200ms で変わっても、最小遅延のサンプルに寄る(遅いパケットで時計が戻らない)
{
  nowMs = 100000;
  const c = mk();
  const hostAt = (ms) => 50 + (ms - 100000) / 1000;
  const delays = [200, 40, 120, 20, 180, 90, 20, 150, 60, 30, 170, 20, 110, 80, 20, 140, 50, 100, 20, 160]; // 2秒ぶん(10Hz)
  for (const d of delays) {
    nowMs += 100;
    c.sample(hostAt(nowMs - d)); // dミリ秒前にホストが送ったパケットが今届いた
  }
  const err = c.time() - hostAt(nowMs);
  assert.ok(err < 0 && err > -0.03, 'ずれは最小遅延(20ms)程度: ' + err);
}

// 往復時間の半分を足す: 片道20msのとき、rtt=40msを渡せばほぼ正しい時刻になる
{
  nowMs = 100000;
  const c = mk();
  c.setRtt(40);
  const hostAt = (ms) => 10 + (ms - 100000) / 1000;
  for (let i = 0; i < 10; i++) { nowMs += 100; c.sample(hostAt(nowMs - 20)); }
  assert.ok(Math.abs(c.time() - hostAt(nowMs)) < 0.002);
}

// 大きなずれは一度で合わせ、小さなずれはなだらかに寄せる
{
  nowMs = 100000;
  const c = mk();
  c.sample(10);
  const t0 = c.time();
  c.sample(10 + 0.05 + (nowMs - 100000) / 1000); // 50msだけ進んでいた
  assert.ok(c.time() > t0 && c.time() < t0 + 0.05, 'なだらかに寄る');
  c.sample(500 + (nowMs - 100000) / 1000);       // 490秒ずれ(ホストを開き直したなど)
  assert.ok(Math.abs(c.time() - 500) < 1e-6, '大きなずれは一度で合わせる');
}

// 不正な値は無視
{
  const c = mk(); c.sample(NaN); c.sample(Infinity); c.setRtt(-1); c.setRtt(NaN);
  assert.equal(c.time(), null); assert.equal(c.rttMs, 0);
}

// 古いサンプルは窓から外れる(ホストの時計が遅い側へ変わったら追従する)
{
  nowMs = 100000;
  const c = mk({ windowMs: 1000, snapMs: 1e9, gain: 1 });
  c.sample(100);                  // offset = 100 - 100 = 0
  nowMs += 2000;
  c.sample(100.5);                // 窓外の古いサンプルは捨てられ、これだけで決まる
  assert.ok(Math.abs(c.time() - 100.5) < 1e-9);
}
console.log('net-clock: ok');

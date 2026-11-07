import assert from 'node:assert/strict';
import { layoutR15, DEFAULT_SCALES } from '../src/avatar/rigs.js';
import { buildR15Rig, solveRig, cfMul, describeRig, R15_JOINTS } from '../src/avatar/rig15.js';

const near = (a, b, eps = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) < eps);
const rotX = (t) => ({ pos: [0, 0, 0], rot: [1, 0, 0, 0, Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t)] });

// 標準レイアウト: Root含め15関節、静止姿勢が完全に再現される
const layout = layoutR15(DEFAULT_SCALES);
const rig = buildR15Rig(layout, DEFAULT_SCALES);
assert.equal(rig.joints.length, 15);
assert.equal(R15_JOINTS.length, 15);
assert.ok(rig.joints.every((j) => j.source === 'approx'));
const w0 = solveRig(rig);
for (const d of layout) {
  assert.ok(near(w0[d.name].pos, d.center), `${d.name} 位置`);
  assert.ok(near(w0[d.name].rot, [1, 0, 0, 0, 1, 0, 0, 0, 1]), `${d.name} 回転`);
}

// 関節の中心は、縦につながる2パーツの重なり内にある(肩・Root・Neckは別扱い)
const by = Object.fromEntries(layout.map((d) => [d.name, d]));
for (const j of rig.joints) {
  if (/Shoulder$|^Root$/.test(j.name)) continue;
  const a = by[j.part0], b = by[j.part1];
  const lo = Math.max(a.center[1] - a.size[1] / 2, b.center[1] - b.size[1] / 2) - 1e-9;
  const hi = Math.min(a.center[1] + a.size[1] / 2, b.center[1] + b.size[1] / 2) + 1e-9;
  assert.ok(j.pivot[1] >= lo && j.pivot[1] <= hi, `${j.name} の関節位置`);
}

// 膝を曲げても、膝の関節位置は動かず、足は動く
const w1 = solveRig(rig, { LeftLowerLeg: rotX(Math.PI / 2) });
const knee = rig.byChild.LeftLowerLeg;
assert.ok(near(cfMul(w1.LeftLowerLeg, knee.c1).pos, knee.pivot, 1e-9), '膝の関節位置が動いた');
assert.ok(!near(w1.LeftFoot.pos, w0.LeftFoot.pos, 1e-3), '足が動いていない');
assert.ok(near(w1.RightFoot.pos, w0.RightFoot.pos), '反対側の足が動いた');

// カスタムパーツの RigAttachment を使う関節は source='rig'、それでも静止姿勢は再現される
const custom = layoutR15(DEFAULT_SCALES).map((d) => (d.name === 'LeftLowerArm'
  ? { ...d, custom: {}, attachments: { LeftElbowRigAttachment: { pos: [0, 0.5, 0], rot: rotX(0.3).rot } } } : d));
const rigC = buildR15Rig(custom, DEFAULT_SCALES);
assert.equal(rigC.byChild.LeftLowerArm.source, 'rig');
assert.equal(rigC.byChild.LeftHand.source, 'approx');
const wc = solveRig(rigC);
for (const d of custom) assert.ok(near(wc[d.name].pos, d.center), `${d.name} カスタム時の位置`);
assert.ok(near(rigC.byChild.LeftLowerArm.pivot, [by.LeftLowerArm.center[0], by.LeftLowerArm.center[1] + 0.5, 0]));
assert.ok(rigC.notes.some((n) => /LeftWrist/.test(n)) === false); // 手は標準パーツ(custom でない)なので注意は出ない
assert.ok(/15関節/.test(describeRig(rigC)));

console.log('rig15 ok');

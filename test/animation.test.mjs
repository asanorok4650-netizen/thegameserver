import assert from 'node:assert/strict';
import { parseKeyframeSequence, samplePoses, blendPoses, posesToCFs, rotToQuat, quatToRot, ease, clipTime } from '../src/rbx/animation.js';
import { createAnimate } from '../src/game/animate.js';

const near = (a, b, eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < eps);
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const rotX = (t) => [1, 0, 0, 0, Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t)];

// 回転 ⇔ クォータニオン
for (const R of [I3, rotX(0.7), rotX(Math.PI), [0, -1, 0, 1, 0, 0, 0, 0, 1], [-1, 0, 0, 0, -1, 0, 0, 0, 1]]) assert.ok(near(quatToRot(rotToQuat(R)), R, 1e-6));

// 合成のツリー(parseModelの結果と同じ形): KeyframeSequence > Keyframe > Pose(入れ子) / KeyframeMarker
const inst = (className, props = {}, children = []) => { const i = { className, props, children, parent: null }; children.forEach((c) => { c.parent = i; }); return i; };
const pose = (name, x, rot, extra = {}, kids = []) => inst('Pose', { Name: name, CFrame: { pos: [x, 0, 0], rot }, ...extra }, kids);
const tree = (root) => { const all = []; const walk = (i) => { all.push(i); i.children.forEach(walk); }; walk(root); return { instances: new Map(all.map((v, k) => [k, v])), roots: [root] }; };
const ks = inst('KeyframeSequence', { Name: 'Walk', Loop: true, Priority: 1 }, [
  inst('Keyframe', { Time: 0 }, [pose('HumanoidRootPart', 9, I3, { Weight: 0 }, [pose('LowerTorso', 0, I3, {}, [pose('LeftUpperLeg', 0, rotX(0), { EasingStyle: 0 })])])]),
  inst('Keyframe', { Time: 1 }, [pose('LowerTorso', 2, I3), pose('LeftUpperLeg', 0, rotX(1), { EasingStyle: 1 }), inst('KeyframeMarker', { Name: 'Step', Value: '1' })]),
  inst('Keyframe', { Time: 2 }, [pose('LowerTorso', 4, I3), pose('LeftUpperLeg', 0, rotX(0))]),
]);
const anim = parseKeyframeSequence(tree(ks));
assert.equal(anim.loop, true);
assert.equal(anim.length, 2);
assert.equal(anim.tracks.HumanoidRootPart, undefined); // Weight 0 は使わない
assert.equal(anim.tracks.LowerTorso.length, 3);
assert.equal(anim.markers.length, 1);

// 補間: 位置は線形、Constant(次のキーまで保持)、範囲外は端の値
assert.ok(near(samplePoses(anim, 0.5).LowerTorso.pos, [1, 0, 0]));
assert.ok(near(samplePoses(anim, 1.5).LowerTorso.pos, [3, 0, 0]));
assert.ok(near(quatToRot(samplePoses(anim, 0.5).LeftUpperLeg.q), rotX(0.5), 1e-6));
assert.ok(near(quatToRot(samplePoses(anim, 1.5).LeftUpperLeg.q), rotX(1), 1e-6)); // 1.0の Constant で保持
assert.ok(near(samplePoses(anim, 5).LowerTorso.pos, [4, 0, 0]));
assert.equal(clipTime(anim, 2.5), 0.5);
assert.ok(ease('Cubic', 'In', 0.5) < 0.5 && ease('Cubic', 'Out', 0.5) > 0.5 && Math.abs(ease('Cubic', 'InOut', 0.5) - 0.5) < 1e-9);
for (const s of ['Elastic', 'Bounce', 'Cubic']) for (const d of ['In', 'Out', 'InOut']) assert.ok(Math.abs(ease(s, d, 0)) < 1e-9 && Math.abs(ease(s, d, 1) - 1) < 1e-9);

// 混ぜる・CFrameへ
const b = blendPoses({ A: { pos: [2, 0, 0], q: [0, 0, 0, 1] } }, {}, 0.5);
assert.ok(near(b.A.pos, [1, 0, 0]));
assert.ok(near(posesToCFs({ A: { pos: [1, 2, 3], q: [0, 0, 0, 1] } }, 2).A.pos, [2, 4, 6]));

// 状態切り替え: クリップが無ければ null、あれば状態に応じたポーズ、切替時はフェード
const ctl = createAnimate();
assert.equal(ctl.update(0.016, 0, true), null);
ctl.setClip('idle', anim); ctl.setClip('walk', anim);
assert.ok(ctl.update(0.016, 0, true).LowerTorso);
assert.equal(ctl.state, 'idle');
ctl.update(0.016, 16, true);
assert.equal(ctl.state, 'walk');
ctl.update(0.016, 0, false);
assert.equal(ctl.state, 'jump');
for (let i = 0; i < 30; i++) ctl.update(0.016, 0, false);
assert.equal(ctl.state, 'fall');
assert.equal(ctl.update(0.016, 0, false), null); // fall のクリップは未設定

console.log('animation ok');

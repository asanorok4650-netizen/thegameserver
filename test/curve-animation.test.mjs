import assert from 'node:assert/strict';
import * as E from './rbxm-encode.mjs';
import { readFloatKeys, readRotationKeys, parseCurveAnimation, sampleCurvePoses, evalFloatCurve, eulerToQuat } from '../src/rbx/curve-animation.js';
import { parseRbxm } from '../src/rbx/rbxm.js';
import { parseAnimation, samplePoses, quatToRot } from '../src/rbx/animation.js';

const near = (a, b, eps = 1e-5) => a.every((v, i) => Math.abs(v - b[i]) < eps);
const hex = (s) => Uint8Array.from(s.match(/../g).map((h) => parseInt(h, 16)));
const u32 = (n) => [...E.u32(n)];
const f32 = (f) => [...E.rawF32(f)];

// 実アセット(カタログのエモートの顔カーブ。0→1を0.2秒)の ValuesAndTimes
const face = hex('02000000' + '02000000' + '0100000000000000a0400000a040' + '01000000803f0000000000000000' + '01000000' + '02000000' + '00000000' + 'e0010000');
const fk = readFloatKeys(face);
assert.equal(fk.length, 2);
assert.ok(near([fk[0].t, fk[1].t, fk[0].v, fk[1].v, fk[0].left], [0, 0.2, 0, 1, 5]));
assert.ok(!fk[0].leftSet && !fk[0].rightSet);
assert.ok(near([evalFloatCurve(fk, 0.1), evalFloatCurve(fk, -1), evalFloatCurve(fk, 9)], [0.5, 0, 1])); // 線形・範囲外は端の値
assert.throws(() => readFloatKeys(face.subarray(0, 20)));
assert.throws(() => readFloatKeys(hex('0300000000000000')));

// 自前のFloatCurveバイト列(補間・接線・時刻をまとめて作る)
const floatBytes = (keys) => new Uint8Array([...u32(2), ...u32(keys.length),
  ...keys.flatMap((k) => [k.i, (k.l !== undefined ? 1 : 0) | (k.r !== undefined ? 2 : 0), ...f32(k.v), ...f32(k.l ?? 0), ...f32(k.r ?? 0)]),
  ...u32(1), ...u32(keys.length), ...keys.flatMap((k) => u32(Math.round(k.t * 2400)))]);

// 補間: Cubic(接線0)はスムーズステップ、Constantは次のキーまで保持、接線未設定のCubicは直線(自動接線)
const cubic = readFloatKeys(floatBytes([{ t: 0, v: 0, i: 2, l: 0, r: 0 }, { t: 1, v: 1, i: 2, l: 0, r: 0 }]));
assert.ok(near([evalFloatCurve(cubic, 0.5), evalFloatCurve(cubic, 0.25)], [0.5, 0.15625]));
const hold = readFloatKeys(floatBytes([{ t: 0, v: 3, i: 0 }, { t: 1, v: 5, i: 1 }, { t: 2, v: 7, i: 1 }]));
assert.ok(near([evalFloatCurve(hold, 0.9), evalFloatCurve(hold, 1.5)], [3, 6]));
const auto = readFloatKeys(floatBytes([{ t: 0, v: 0, i: 2 }, { t: 1, v: 1, i: 2 }]));
assert.ok(near([evalFloatCurve(auto, 0.5)], [0.5]));

// 四元数カーブ(版1・25バイト/キー)
const q90 = eulerToQuat(Math.PI / 2, 0, 0);
const rotBytes = new Uint8Array([...u32(1), ...u32(2),
  1, ...[0, 0, 0, 1].flatMap(f32), ...f32(0), ...f32(0),
  1, ...q90.flatMap(f32), ...f32(0), ...f32(0),
  ...u32(1), ...u32(2), ...u32(0), ...u32(2400)]);
const rk = readRotationKeys(rotBytes);
assert.ok(near(rk[1].q, q90) && rk[1].t === 1);

// オイラー角 → 回転: XYZ順で X 90°
assert.ok(near(quatToRot(eulerToQuat(Math.PI / 2, 0, 0)), [1, 0, 0, 0, 0, -1, 0, 1, 0]));
assert.ok(near(quatToRot(eulerToQuat(0.3, 0.5, 0.7, 'XYZ')).map((v, i) => v - quatToRot(eulerToQuat(0.3, 0.5, 0.7, 'ZYX'))[i]), [0, 0, 0, 0, 0, 0, 0, 0, 0]) === false); // 順序で結果が変わる

// バイナリrbxm → parseAnimation(カーブ形式)の通し: ValuesAndTimes がUTF-8で壊れずに届く
const ctx = (name, bytes) => [...E.u32(bytes.length), ...bytes];
const xCurve = floatBytes([{ t: 0, v: 0, i: 1 }, { t: 1, v: 2, i: 1 }]);
const rxCurve = floatBytes([{ t: 0, v: 0, i: 1 }, { t: 1, v: Math.PI / 2, i: 1 }]);
const chunks = [
  E.inst(0, 'CurveAnimation', [0]), E.inst(1, 'Folder', [1]), E.inst(2, 'Vector3Curve', [2]), E.inst(3, 'FloatCurve', [3]),
  E.inst(4, 'EulerRotationCurve', [4]), E.inst(5, 'FloatCurve', [5]),
  E.prop(0, 'Name', 1, E.str('Walk')), E.prop(0, 'Loop', 2, [1]),
  E.prop(1, 'Name', 1, E.str('LowerTorso')), E.prop(2, 'Name', 1, E.str('Position')), E.prop(3, 'Name', 1, E.str('X')),
  E.prop(3, 'ValuesAndTimes', 1, ctx('x', xCurve)),
  E.prop(4, 'Name', 1, E.str('Rotation')), E.prop(4, 'RotationOrder', 0x12, E.encU32s([0])),
  E.prop(5, 'Name', 1, E.str('X')), E.prop(5, 'ValuesAndTimes', 1, ctx('rx', rxCurve)),
  E.prnt([1, 2, 3, 4, 5, 0], [0, 1, 2, 1, 4, -1]),
];
const buf = E.file(chunks, 6, 6);
const tree = parseRbxm(buf);
const vt = [...tree.instances.values()].find((i) => i.className === 'FloatCurve').props.ValuesAndTimes;
assert.ok(vt instanceof Uint8Array && vt.length === xCurve.length);
const anim = parseAnimation(buf);
assert.equal(anim.kind, 'curve');
assert.equal(anim.loop, true);
assert.equal(anim.length, 1);
assert.deepEqual(Object.keys(anim.channels), ['LowerTorso']);
const p = samplePoses(anim, 0.5); // animation.js の samplePoses がカーブ形式を振り分ける
assert.ok(near(p.LowerTorso.pos, [1, 0, 0]));
assert.ok(near(quatToRot(p.LowerTorso.q), quatToRot(eulerToQuat(Math.PI / 4, 0, 0)), 1e-5));
assert.ok(near(sampleCurvePoses(anim, 5).LowerTorso.pos, [2, 0, 0]));
assert.equal(parseCurveAnimation({ instances: new Map(), roots: [] }), null);

console.log('curve-animation ok');

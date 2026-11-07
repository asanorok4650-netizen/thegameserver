// R15のリグ(Motor6D相当の関節情報)を、レイアウトから組み立てる。THREE非依存。
// アニメーション(KeyframeSequence)のPoseは「Part1(子パーツ)名」をキーに、Motor6D.Transform として適用される:
//   Part1.CFrame = Part0.CFrame * C0 * Transform * C1:Inverse()
// C1 は子パーツの `${関節名}RigAttachment`(カスタムのボディパーツが持つ実測値)。無ければ標準レイアウトの関節位置から近似する。
// C0 は、静止姿勢(Transform=単位)でレイアウトを正確に再現するように逆算する。よって見た目は今と変わらない。
import { JOINTS, defaultJoint } from './bodyparts.js';

const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const mv = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
const mm = (A, B) => { const o = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o.push(A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]); return o; };
const tr = (R) => [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]];

/** CFrame = { pos:[x,y,z], rot:[3x3 行優先] }(rbxmパーサ・rigs.js と同じ表現) */
export const CF_IDENTITY = { pos: [0, 0, 0], rot: I3 };
export const cfMul = (a, b) => ({ pos: mv(a.rot, b.pos).map((v, k) => v + a.pos[k]), rot: mm(a.rot, b.rot) });
export const cfInv = (a) => { const t = tr(a.rot); return { pos: mv(t, a.pos).map((v) => -v), rot: t }; };

/** [Part0, Part1, 関節名]。親が先に並ぶ。Root(HumanoidRootPart→LowerTorso)を先頭に足す。 */
export const R15_ROOT_JOINT = ['HumanoidRootPart', 'LowerTorso', 'Root'];
export const R15_JOINTS = [R15_ROOT_JOINT, ...JOINTS];

/**
 * @param layout layoutFor('R15') または applyBodyParts() 後のレイアウト
 * @returns { joints:[{name, part0, part1, c0, c1, pivot, source:'rig'|'approx'}], byChild, rest, notes }
 *   rest: パーツ名 → 静止姿勢のワールドCFrame(HumanoidRootPart は LowerTorso の中心に置く)
 */
export function buildR15Rig(layout, scales = {}) {
  const h = scales.height ?? 1;
  const by = Object.fromEntries(layout.map((d) => [d.name, d]));
  const lt = by.LowerTorso;
  if (!lt) throw new Error('R15のレイアウトではありません(LowerTorsoがありません)');
  const rest = {};
  for (const d of layout) rest[d.name] = { pos: [...d.center], rot: d.rot || I3 };
  rest.HumanoidRootPart = { pos: [...lt.center], rot: I3 };

  const joints = [], byChild = {}, notes = [];
  for (const [p, c, name] of R15_JOINTS) {
    const dc = by[c];
    if (!dc || !rest[p]) continue;
    const key = `${name}RigAttachment`;
    const own = dc.custom && dc.attachments && dc.attachments[key];
    let c1, source;
    if (own) {
      c1 = { pos: [...own.pos], rot: own.rot || I3 };
      source = 'rig';
    } else {
      if (dc.custom) notes.push(`${c}: ${key} が無いため標準位置で代用`);
      const W = name === 'Root' ? lt.center : defaultJoint(name, by[p], dc, h);
      const P1 = rest[c];
      c1 = { pos: mv(tr(P1.rot), W.map((v, k) => v - P1.pos[k])), rot: I3 };
      source = 'approx';
    }
    const c0 = cfMul(cfInv(rest[p]), cfMul(rest[c], c1)); // 静止姿勢で Part0*C0*C1⁻¹ = Part1 になるように
    const pivot = cfMul(rest[c], c1).pos;
    const j = { name, part0: p, part1: c, c0, c1, pivot, source };
    joints.push(j);
    byChild[c] = j;
  }
  return { joints, byChild, rest, notes };
}

/**
 * 順運動学: 各関節のTransform(キーは子パーツ名=Pose名)から、全パーツのワールドCFrameを求める。
 * transforms に無い関節は単位(静止)。rootCF で HumanoidRootPart を動かせる。
 */
export function solveRig(rig, transforms = {}, rootCF = null) {
  const world = { HumanoidRootPart: rootCF || rig.rest.HumanoidRootPart };
  for (const j of rig.joints) {
    const P0 = world[j.part0];
    if (!P0) continue;
    world[j.part1] = cfMul(cfMul(cfMul(P0, j.c0), transforms[j.part1] || CF_IDENTITY), cfInv(j.c1));
  }
  return world;
}

/** ログ表示用の要約 */
export function describeRig(rig) {
  const real = rig.joints.filter((j) => j.source === 'rig').map((j) => j.name);
  const approx = rig.joints.filter((j) => j.source === 'approx').map((j) => j.name);
  return `リグ: ${rig.joints.length}関節(RigAttachment実測 ${real.length} / 近似 ${approx.length})`
    + (approx.length && real.length ? ` 近似: ${approx.join(',')}` : '')
    + (rig.notes.length ? ` 注意: ${rig.notes.join(' / ')}` : '');
}

// カスタムのボディパーツ(メッシュ)を、リグのレイアウトへ組み込む。THREE非依存。
// R6 : 位置は標準のまま、パーツの見た目(メッシュ)だけ差し替える。
// R15: Roblox本家と同じく「RigAttachment同士を一致させる」方式で、関節ごとに位置・回転を決める。
//      カスタムでないパーツ(標準の箱)側のアタッチメントは、標準レイアウトの関節位置から近似する。
import { R6_NAMES } from '../rbx/bodypart.js';

const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const mv = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
const mm = (A, B) => { const o = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o.push(A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]); return o; };
const tr = (R) => [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]];

// [親, 子, 関節名] 親が先に並ぶこと。アタッチメント名は `${関節名}RigAttachment`
const JOINTS = [
  ['LowerTorso', 'UpperTorso', 'Waist'], ['UpperTorso', 'Head', 'Neck'],
  ['UpperTorso', 'LeftUpperArm', 'LeftShoulder'], ['LeftUpperArm', 'LeftLowerArm', 'LeftElbow'], ['LeftLowerArm', 'LeftHand', 'LeftWrist'],
  ['UpperTorso', 'RightUpperArm', 'RightShoulder'], ['RightUpperArm', 'RightLowerArm', 'RightElbow'], ['RightLowerArm', 'RightHand', 'RightWrist'],
  ['LowerTorso', 'LeftUpperLeg', 'LeftHip'], ['LeftUpperLeg', 'LeftLowerLeg', 'LeftKnee'], ['LeftLowerLeg', 'LeftFoot', 'LeftAnkle'],
  ['LowerTorso', 'RightUpperLeg', 'RightHip'], ['RightUpperLeg', 'RightLowerLeg', 'RightKnee'], ['RightLowerLeg', 'RightFoot', 'RightAnkle'],
];

/** 標準レイアウト(base)上の関節のワールド位置(近似)。 */
function defaultJoint(joint, P, C, h) {
  if (/Shoulder$/.test(joint)) { // 腕の内側の縁、上端から少し下
    const sg = C.center[0] < 0 ? -1 : 1;
    return [C.center[0] - sg * C.size[0] / 2, C.center[1] + C.size[1] / 2 - 0.18 * h, 0];
  }
  const lo = Math.max(P.center[1] - P.size[1] / 2, C.center[1] - C.size[1] / 2);
  const hi = Math.min(P.center[1] + P.size[1] / 2, C.center[1] + C.size[1] / 2);
  return [C.center[0], (lo + hi) / 2, 0];
}

const pickInfo = (e, scales) => ((scales.bodyType || 0) >= 0.5 ? (e.artist || e.fixed) : (e.fixed || e.artist));

/**
 * @param layout layoutFor() の結果
 * @param bodyParts { slot: { rig, parts:{ name:{fixed,artist} } } } (各infoに geometry / texture が付いたもの)
 * @returns { layout, notes } layoutは新しい配列。カスタムのdefは custom:{info}, attachments, rot を持つ。
 */
export function applyBodyParts(layout, rigType, scales, bodyParts) {
  const notes = [];
  if (!bodyParts || !Object.keys(bodyParts).length) return { layout, notes };
  const defs = layout.map((d) => ({ ...d }));
  const byName = Object.fromEntries(defs.map((d) => [d.name, d]));

  if (rigType === 'R6') {
    for (const [slot, pn] of Object.entries(R6_NAMES)) {
      const e = bodyParts[slot] && bodyParts[slot].parts[pn];
      const info = e && (e.fixed || e.artist);
      if (!info || !info.geometry) continue;
      Object.assign(byName[pn], { custom: { info }, attachments: info.attachments });
    }
    return { layout: defs, notes };
  }

  const base = Object.fromEntries(defs.map((d) => [d.name, { center: [...d.center], size: [...d.size] }]));
  let any = false;
  for (const bp of Object.values(bodyParts)) {
    for (const [pn, e] of Object.entries(bp.parts)) {
      const d = byName[pn];
      const info = d && pickInfo(e, scales);
      if (!info || !info.geometry) continue;
      const hs = scales.head * scales.height;
      const f = pn === 'Head' ? [hs, hs, hs] : [scales.width, scales.height, scales.depth];
      d.size = info.size.map((v, k) => v * f[k]);
      d.custom = { info };
      d.attachments = {};
      for (const [an, a] of Object.entries(info.attachments)) d.attachments[an] = { pos: a.pos.map((v, k) => v * f[k]), rot: a.rot };
      d.rot = I3;
      any = true;
    }
  }
  if (!any) return { layout: defs, notes };

  const cur = Object.fromEntries(defs.map((d) => [d.name, { center: [...base[d.name].center], rot: I3 }]));
  const moved = new Set();
  if (byName.LowerTorso.custom) moved.add('LowerTorso');
  const local = (name, joint, W) => {
    const d = byName[name], key = `${joint}RigAttachment`;
    if (d.custom) {
      if (d.attachments[key]) return d.attachments[key];
      notes.push(`${name}: ${key} が無いため標準位置で代用`);
    }
    return { pos: W.map((v, k) => v - base[name].center[k]), rot: I3 };
  };
  for (const [p, c, j] of JOINTS) {
    if (!(byName[c].custom || moved.has(p))) continue;
    const W = defaultJoint(j, base[p], base[c], scales.height);
    const aP = local(p, j, W), aC = local(c, j, W);
    const P = cur[p];
    const jw = mv(P.rot, aP.pos).map((v, k) => v + P.center[k]);
    const Rc = mm(mm(P.rot, aP.rot), tr(aC.rot));
    const off = mv(Rc, aC.pos);
    cur[c] = { center: jw.map((v, k) => v - off[k]), rot: Rc };
    moved.add(c);
  }
  // 足裏が y=0 になるように持ち上げる
  let minY = Infinity;
  for (const d of defs) {
    const R = cur[d.name].rot;
    const half = (Math.abs(R[3]) * d.size[0] + Math.abs(R[4]) * d.size[1] + Math.abs(R[5]) * d.size[2]) / 2;
    minY = Math.min(minY, cur[d.name].center[1] - half);
  }
  for (const d of defs) {
    d.center = [cur[d.name].center[0], cur[d.name].center[1] - minY, cur[d.name].center[2]];
    d.rot = cur[d.name].rot;
  }
  return { layout: defs, notes };
}

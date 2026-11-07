// RobloxのKeyframeSequence(アニメーション)の解析と、時刻からのポーズ計算。THREE非依存。
// Pose名 = 子パーツ名 = Motor6D(関節)名のキー。Poseの入れ子は無視して、パーツ名ごとの時系列に直す。
// 補間: あるキーフレームのPoseのEasingStyle/Directionが、そのキーフレームから「次のキーフレーム」までの区間に効く(要・実アニメで検証)。
//       Weight<=0 のPoseは使わない(HumanoidRootPartなど)。
import { parseModel } from './model.js';

const EASE_STYLES = ['Linear', 'Constant', 'Elastic', 'Cubic', 'Bounce', 'CubicV2'];
const EASE_DIRS = ['In', 'Out', 'InOut'];

// ---- 回転(行優先3x3 ⇔ クォータニオン[x,y,z,w]) ----
export function rotToQuat(m) {
  const t = m[0] + m[4] + m[8];
  let x, y, z, w, s;
  if (t > 0) { s = Math.sqrt(t + 1) * 2; w = s / 4; x = (m[7] - m[5]) / s; y = (m[2] - m[6]) / s; z = (m[3] - m[1]) / s; }
  else if (m[0] > m[4] && m[0] > m[8]) { s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2; w = (m[7] - m[5]) / s; x = s / 4; y = (m[1] + m[3]) / s; z = (m[2] + m[6]) / s; }
  else if (m[4] > m[8]) { s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2; w = (m[2] - m[6]) / s; x = (m[1] + m[3]) / s; y = s / 4; z = (m[5] + m[7]) / s; }
  else { s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2; w = (m[3] - m[1]) / s; x = (m[2] + m[6]) / s; y = (m[5] + m[7]) / s; z = s / 4; }
  const n = Math.hypot(x, y, z, w) || 1;
  return [x / n, y / n, z / n, w / n];
}
export function quatToRot([x, y, z, w]) {
  return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
}
function slerp(a, b, u) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (d < 0) { d = -d; bb = [-b[0], -b[1], -b[2], -b[3]]; }
  let ka, kb;
  if (d > 0.9995) { ka = 1 - u; kb = u; }
  else { const th = Math.acos(d), s = Math.sin(th); ka = Math.sin((1 - u) * th) / s; kb = Math.sin(u * th) / s; }
  const q = [ka * a[0] + kb * bb[0], ka * a[1] + kb * bb[1], ka * a[2] + kb * bb[2], ka * a[3] + kb * bb[3]];
  const n = Math.hypot(...q) || 1;
  return q.map((v) => v / n);
}
const lerp3 = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];

// ---- イージング ----
const bounceOut = (t) => {
  const n1 = 7.5625, d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
};
const IN = {
  Cubic: (t) => t * t * t,
  CubicV2: (t) => t * t * t,
  Bounce: (t) => 1 - bounceOut(1 - t),
  Elastic: (t) => (t === 0 ? 0 : t === 1 ? 1 : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * (2 * Math.PI / 3))),
};
/** u: 0〜1 → 0〜1 */
export function ease(style, dir, u) {
  if (style === 'Linear') return u;
  if (style === 'Constant') return u >= 1 ? 1 : 0;
  const f = IN[style] || IN.Cubic;
  if (dir === 'Out') return 1 - f(1 - u);
  if (dir === 'InOut') return u < 0.5 ? f(2 * u) / 2 : 1 - f(2 * (1 - u)) / 2;
  return f(u);
}

// ---- 解析 ----
function collectPoses(inst, out) {
  for (const c of inst.children) {
    if (c.className === 'Pose') { out.push(c); collectPoses(c, out); }
  }
}

/** parseModel の結果から KeyframeSequence を取り出す。無ければ null */
export function parseKeyframeSequence(tree) {
  const ks = [...tree.instances.values()].find((i) => i.className === 'KeyframeSequence');
  if (!ks) return null;
  const tracks = {}, markers = [];
  let length = 0, poseCount = 0, keyframeCount = 0;
  for (const kf of ks.children.filter((c) => c.className === 'Keyframe')) {
    keyframeCount++;
    const t = Number(kf.props.Time) || 0;
    length = Math.max(length, t);
    const poses = [];
    collectPoses(kf, poses);
    for (const p of poses) {
      const w = p.props.Weight === undefined ? 1 : p.props.Weight;
      const cf = p.props.CFrame;
      if (!cf || w <= 0) continue;
      poseCount++;
      const name = p.props.Name !== undefined ? p.props.Name : 'Pose';
      (tracks[name] || (tracks[name] = [])).push({
        t, pos: [...cf.pos], q: rotToQuat(cf.rot),
        style: EASE_STYLES[p.props.EasingStyle] || 'Linear', dir: EASE_DIRS[p.props.EasingDirection] || 'In',
      });
    }
    for (const m of kf.children.filter((c) => c.className === 'KeyframeMarker')) {
      markers.push({ time: t, name: m.props.Name, value: m.props.Value });
    }
  }
  for (const arr of Object.values(tracks)) arr.sort((a, b) => a.t - b.t);
  return {
    name: ks.props.Name || 'KeyframeSequence', loop: !!ks.props.Loop, priority: ks.props.Priority ?? 0,
    length, tracks, markers, keyframeCount, poseCount,
  };
}

/** アセットのバイト列(rbxm / rbxmx)からアニメーションを読む。CurveAnimation形式は未対応 */
export function parseAnimation(buf) {
  const tree = parseModel(buf);
  const anim = parseKeyframeSequence(tree);
  if (anim) return anim;
  if ([...tree.instances.values()].some((i) => i.className === 'CurveAnimation')) throw new Error('CurveAnimation形式のアニメーションは未対応です');
  throw new Error('KeyframeSequence が見つかりません');
}

// ---- 再生計算 ----
/** 時刻 t(秒)を、アニメーションの範囲に収める(ループなら折り返す) */
export function clipTime(anim, t) {
  if (!(anim.length > 0)) return 0;
  return anim.loop ? t % anim.length : Math.min(t, anim.length);
}

/** @returns { パーツ名: { pos:[x,y,z], q:[x,y,z,w] } }(Pose名 = 子パーツ名) */
export function samplePoses(anim, t) {
  const out = {};
  for (const [name, arr] of Object.entries(anim.tracks)) {
    if (t <= arr[0].t) { out[name] = { pos: arr[0].pos, q: arr[0].q }; continue; }
    const last = arr[arr.length - 1];
    if (t >= last.t) { out[name] = { pos: last.pos, q: last.q }; continue; }
    let i = 0;
    while (i + 2 < arr.length && arr[i + 1].t <= t) i++;
    const a = arr[i], b = arr[i + 1];
    const u = ease(a.style, a.dir, (t - a.t) / (b.t - a.t));
    out[name] = { pos: lerp3(a.pos, b.pos, u), q: slerp(a.q, b.q, u) };
  }
  return out;
}

const REST = { pos: [0, 0, 0], q: [0, 0, 0, 1] };
/** 2つのポーズ集合を w(0〜1) で混ぜる。片方に無い関節は静止姿勢として扱う */
export function blendPoses(a, b, w) {
  const out = {};
  for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const pa = a[name] || REST, pb = b[name] || REST;
    out[name] = { pos: lerp3(pa.pos, pb.pos, w), q: slerp(pa.q, pb.q, w) };
  }
  return out;
}

/** ポーズ集合 → { パーツ名: CFrame{pos,rot} }。posScale は移動量の拡大率(アバターの身長倍率) */
export function posesToCFs(poses, posScale = 1) {
  const out = {};
  for (const [name, p] of Object.entries(poses)) out[name] = { pos: p.pos.map((v) => v * posScale), rot: quatToRot(p.q) };
  return out;
}

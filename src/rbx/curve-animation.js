// CurveAnimation(カーブ形式のアニメーション)の解析と再生計算。THREE非依存。
// 構造: CurveAnimation > Folder(関節名=子パーツ名。リグに沿って入れ子) > Vector3Curve "Position"(FloatCurve X/Y/Z)
//                                                              と EulerRotationCurve "Rotation"(RotationOrder, FloatCurve X/Y/Z)。四元数の RotationCurve も読む。
// キーは ValuesAndTimes(バイナリ)。形式はRoblox非公開で、実アセットから解読された公開情報(chteau/rbx-native)に基づく。すべてリトルエンディアン:
//   FloatCurve   : u32 2, u32 n, n×{u8 補間, u8 接線フラグ(bit0=左あり bit1=右あり), f32 値, f32 左接線, f32 右接線}, u32 1, u32 n, n×u32 時刻(1/2400秒)
//   RotationCurve: 値の版が1。キーは {u8 補間(下位2bit), f32 x,y,z,w, f32 左接線, f32 右接線}
// 補間(KeyInterpolationMode): 0=Constant 1=Linear 2=Cubic(エルミート。接線は「値/秒」)。接線が未設定のCubicは前後のキーから自動計算する(Robloxの自動接線と同じかは未検証)。
const TICKS_PER_SECOND = 2400;
const ORDERS = ['XYZ', 'XZY', 'YZX', 'YXZ', 'ZXY', 'ZYX'];

// ---- 四元数 [x,y,z,w] ----
export function slerp(a, b, u) {
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
const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qAxis = (axis, a) => { const s = Math.sin(a / 2), c = Math.cos(a / 2); return axis === 'X' ? [s, 0, 0, c] : axis === 'Y' ? [0, s, 0, c] : [0, 0, s, c]; };
/** オイラー角(rad) → 四元数。order が 'ABC' なら R = Ra * Rb * Rc(CFrame.fromEulerAngles と同じ想定) */
export function eulerToQuat(x, y, z, order = 'XYZ') {
  const v = { X: x, Y: y, Z: z };
  return qMul(qMul(qAxis(order[0], v[order[0]]), qAxis(order[1], v[order[1]])), qAxis(order[2], v[order[2]]));
}

// ---- ValuesAndTimes ----
function reader(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  const need = (n) => { if (p + n > bytes.length) throw new Error(`ValuesAndTimes が途中で終わっています(${p}バイト目)`); };
  return {
    u8() { need(1); return dv.getUint8(p++); },
    u32() { need(4); const v = dv.getUint32(p, true); p += 4; return v; },
    f32() { need(4); const v = dv.getFloat32(p, true); p += 4; return v; },
    end() { return p === bytes.length; },
  };
}
function readTimes(r, n, keys) {
  if (r.u32() !== 1) throw new Error('ValuesAndTimes: 時刻の版が未対応です');
  if (r.u32() !== n) throw new Error('ValuesAndTimes: 時刻の数が合いません');
  for (let i = 0; i < n; i++) keys[i].t = r.u32() / TICKS_PER_SECOND;
  if (!r.end()) throw new Error('ValuesAndTimes: キーの後ろに余分なバイトがあります');
}
function readCount(r, version, bytes) {
  if (r.u32() !== version) throw new Error('ValuesAndTimes: 値の版が未対応です');
  const n = r.u32();
  if (n > bytes.length / 5) throw new Error(`ValuesAndTimes: キー数が不正です(${n})`);
  return n;
}

/** FloatCurve のキー → [{t, v, interp, left, right, leftSet, rightSet}] */
export function readFloatKeys(bytes) {
  const r = reader(bytes), n = readCount(r, 2, bytes), keys = [];
  for (let i = 0; i < n; i++) {
    const interp = r.u8(), flags = r.u8(), v = r.f32(), left = r.f32(), right = r.f32();
    keys.push({ t: 0, v, interp, left, right, leftSet: !!(flags & 1), rightSet: !!(flags & 2) });
  }
  readTimes(r, n, keys);
  return keys;
}
/** RotationCurve(四元数)のキー → [{t, q:[x,y,z,w], interp}] */
export function readRotationKeys(bytes) {
  const r = reader(bytes), n = readCount(r, 1, bytes), keys = [];
  for (let i = 0; i < n; i++) {
    const interp = r.u8() & 3, q = [r.f32(), r.f32(), r.f32(), r.f32()];
    r.f32(); r.f32(); // 左右の接線(四元数は球面線形で代用するので使わない)
    keys.push({ t: 0, q, interp });
  }
  readTimes(r, n, keys);
  return keys;
}

function toBytes(v) { // バイナリrbxmはUint8Array、XMLはbase64文字列
  if (v instanceof Uint8Array) return v;
  if (typeof v === 'string' && v.length) {
    try { return Uint8Array.from(atob(v.replace(/\s+/g, '')), (c) => c.charCodeAt(0)); } catch (e) { return null; }
  }
  return null;
}

// ---- 解析 ----
/** parseModel の結果から CurveAnimation を取り出す。無ければ null。再生計算は sampleCurvePoses */
export function parseCurveAnimation(tree) {
  const ca = [...tree.instances.values()].find((i) => i.className === 'CurveAnimation');
  if (!ca) return null;
  const channels = {}, warnings = [];
  let length = 0, keyCount = 0;
  const floatKeys = (fc) => {
    const bytes = fc && toBytes(fc.props.ValuesAndTimes);
    if (!bytes || !bytes.length) return null;
    const keys = readFloatKeys(bytes);
    if (!keys.length) return null;
    length = Math.max(length, keys[keys.length - 1].t); keyCount += keys.length;
    return keys;
  };
  const axes = (curve) => ['X', 'Y', 'Z'].map((a) => floatKeys(curve.children.find((c) => c.className === 'FloatCurve' && c.props.Name === a)));
  const walk = (parent) => {
    for (const f of parent.children.filter((c) => c.className === 'Folder')) {
      const name = f.props.Name;
      const ch = {};
      try {
        const pos = f.children.find((c) => c.className === 'Vector3Curve' && (c.props.Name === 'Position' || c.props.Name === undefined));
        if (pos) { const a = axes(pos); if (a.some(Boolean)) ch.pos = a; }
        const rot = f.children.find((c) => (c.className === 'EulerRotationCurve' || c.className === 'RotationCurve') && c.props.Name === 'Rotation')
          || f.children.find((c) => c.className === 'EulerRotationCurve' || c.className === 'RotationCurve');
        if (rot && rot.className === 'EulerRotationCurve') {
          const a = axes(rot);
          if (a.some(Boolean)) ch.euler = { order: ORDERS[rot.props.RotationOrder] || 'XYZ', curves: a };
        } else if (rot) {
          const bytes = toBytes(rot.props.ValuesAndTimes);
          const keys = bytes && bytes.length ? readRotationKeys(bytes) : [];
          if (keys.length) { ch.quat = keys; length = Math.max(length, keys[keys.length - 1].t); keyCount += keys.length; }
        }
      } catch (e) { warnings.push(`${name}: ${e.message}`); }
      if (ch.pos || ch.euler || ch.quat) channels[name] = ch;
      walk(f);
    }
  };
  walk(ca);
  return {
    kind: 'curve', name: ca.props.Name || 'CurveAnimation', loop: !!ca.props.Loop, priority: ca.props.Priority ?? 0,
    length, channels, markers: [], keyframeCount: keyCount, poseCount: Object.keys(channels).length, warnings,
  };
}

// ---- 再生計算 ----
function autoSlope(keys, i) {
  if (keys.length < 2) return 0;
  if (i === 0) return (keys[1].v - keys[0].v) / ((keys[1].t - keys[0].t) || 1);
  if (i === keys.length - 1) return (keys[i].v - keys[i - 1].v) / ((keys[i].t - keys[i - 1].t) || 1);
  return (keys[i + 1].v - keys[i - 1].v) / ((keys[i + 1].t - keys[i - 1].t) || 1);
}
function segment(keys, t) { // t が入る区間の左キーの添字
  let i = 0;
  while (i + 2 < keys.length && keys[i + 1].t <= t) i++;
  return i;
}
/** FloatCurve を時刻 t で評価。キーが無ければ null */
export function evalFloatCurve(keys, t) {
  if (!keys || !keys.length) return null;
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  const i = segment(keys, t), a = keys[i], b = keys[i + 1];
  const dt = b.t - a.t, u = (t - a.t) / dt;
  if (a.interp === 0) return a.v;
  if (a.interp === 1) return a.v + (b.v - a.v) * u;
  const m0 = a.rightSet ? a.right : autoSlope(keys, i), m1 = b.leftSet ? b.left : autoSlope(keys, i + 1);
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * a.v + (u3 - 2 * u2 + u) * dt * m0 + (-2 * u3 + 3 * u2) * b.v + (u3 - u2) * dt * m1;
}
function evalQuatCurve(keys, t) {
  if (t <= keys[0].t) return keys[0].q;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.q;
  const i = segment(keys, t), a = keys[i], b = keys[i + 1];
  return a.interp === 0 ? a.q : slerp(a.q, b.q, (t - a.t) / (b.t - a.t));
}

/** @returns { パーツ名: { pos:[x,y,z], q:[x,y,z,w] } }(samplePoses と同じ形)。無いチャンネルは静止(0 / 単位) */
export function sampleCurvePoses(anim, t) {
  const out = {};
  for (const [name, ch] of Object.entries(anim.channels)) {
    const pos = ch.pos ? ch.pos.map((k) => evalFloatCurve(k, t) ?? 0) : [0, 0, 0];
    let q = [0, 0, 0, 1];
    if (ch.euler) { const [x, y, z] = ch.euler.curves.map((k) => evalFloatCurve(k, t) ?? 0); q = eulerToQuat(x, y, z, ch.euler.order); }
    else if (ch.quat) q = evalQuatCurve(ch.quat, t);
    out[name] = { pos, q };
  }
  return out;
}

// クリックで選ぶためのレイ判定(THREE非依存)。パーツを回転した箱(OBB)として扱う。
// 描画はInstancedMeshにまとめるので、描画側のレイキャストは使わず、docのparts配列を直接調べる(10万個でも1クリック数ms)。

/** rot は行優先の3x3(world.json と同じ)。ローカル→ワールドは R * v + pos */
export function rayVsPart(o, d, p) {
  const m = p.rot, h = [p.size[0] / 2, p.size[1] / 2, p.size[2] / 2];
  const rx = o[0] - p.pos[0], ry = o[1] - p.pos[1], rz = o[2] - p.pos[2];
  let tmin = -Infinity, tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    // Rᵀ をかける = i番目の列との内積
    const lo = m[i] * rx + m[3 + i] * ry + m[6 + i] * rz;
    const ld = m[i] * d[0] + m[3 + i] * d[1] + m[6 + i] * d[2];
    if (Math.abs(ld) < 1e-12) {
      if (lo < -h[i] || lo > h[i]) return null; // 平行で箱の外
      continue;
    }
    let t1 = (-h[i] - lo) / ld, t2 = (h[i] - lo) / ld;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return tmin >= 0 ? tmin : tmax; // 箱の中から始まった場合は出口を返す
}

/** 最も手前のパーツ。@returns { id, t } | null。ignore に入れたidは無視 */
export function pickPart(parts, origin, dir, { ignore = null, maxDist = Infinity } = {}) {
  let best = null;
  for (const p of parts) {
    if (ignore && ignore.has(p.id)) continue;
    const t = rayVsPart(origin, dir, p);
    if (t !== null && t <= maxDist && (!best || t < best.t)) best = { id: p.id, t };
  }
  return best;
}

/** 水平面 y=planeY との交点(新規パーツの置き場所用)。交わらなければ null */
export function rayVsPlaneY(o, d, planeY = 0) {
  if (Math.abs(d[1]) < 1e-9) return null;
  const t = (planeY - o[1]) / d[1];
  return t > 0 ? [o[0] + d[0] * t, planeY, o[2] + d[2] * t] : null;
}

/** グリッドへのスナップ(step<=0 なら何もしない) */
export const snap = (v, step) => (step > 0 ? Math.round(v / step) * step : v);

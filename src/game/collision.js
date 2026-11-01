// 静的パーツとの衝突(THREE非依存)。プレイヤーは球を縦に並べて近似し、押し出しで解決する。
// box=球とOBBの最近接点(正確)、convex(楔・角楔)=平面との最小めり込み、ball=球同士。
import { POLY } from '../rbx/primitives.js';

export function planesFromPoly(def, size) {
  const vs = def.v.map((v) => [v[0] * size[0], v[1] * size[1], v[2] * size[2]]);
  const c = [0, 0, 0];
  for (const v of vs) for (let k = 0; k < 3; k++) c[k] += v[k] / vs.length;
  const planes = [];
  for (const f of def.f) {
    const a = vs[f[0]], b = vs[f[1]], d = vs[f[2]];
    let n = [(b[1] - a[1]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[1] - a[1]),
      (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]),
      (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0])];
    const len = Math.hypot(n[0], n[1], n[2]);
    if (len < 1e-9) continue;
    n = n.map((x) => x / len);
    if (n[0] * (a[0] - c[0]) + n[1] * (a[1] - c[1]) + n[2] * (a[2] - c[2]) < 0) n = n.map((x) => -x);
    planes.push([n[0], n[1], n[2], n[0] * a[0] + n[1] * a[1] + n[2] * a[2]]);
  }
  return planes;
}
export const wedgePlanes = (size) => planesFromPoly(POLY.wedge, size);
export const cornerPlanes = (size) => planesFromPoly(POLY.corner, size);

/** 球と回転した箱(OBB)の重なり判定。タグ付きトリガー用で、衝突応答は行わない。 */
export function sphereIntersectsOBB(point, radius, box) {
  const dx = point[0] - box.pos[0], dy = point[1] - box.pos[1], dz = point[2] - box.pos[2];
  const R = box.rot, h = box.half;
  const lx = R[0] * dx + R[3] * dy + R[6] * dz;
  const ly = R[1] * dx + R[4] * dy + R[7] * dz;
  const lz = R[2] * dx + R[5] * dy + R[8] * dz;
  const qx = Math.max(-h[0], Math.min(h[0], lx));
  const qy = Math.max(-h[1], Math.min(h[1], ly));
  const qz = Math.max(-h[2], Math.min(h[2], lz));
  const ex = lx - qx, ey = ly - qy, ez = lz - qz;
  return ex * ex + ey * ey + ez * ez <= radius * radius;
}

const CELL = 16;
const hash = (x, y, z) => ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) | 0;

export class CollisionWorld {
  constructor() {
    this.items = [];
    this.grid = new Map();
    this.big = [];
    this.stamp = 0;
    this.maxNy = -1;
    this.minNy = 1;
  }

  add(c) {
    const R = c.rot, h = c.half, p = c.pos;
    const e = c.type === 'ball' ? [c.radius, c.radius, c.radius] : [
      Math.abs(R[0]) * h[0] + Math.abs(R[1]) * h[1] + Math.abs(R[2]) * h[2],
      Math.abs(R[3]) * h[0] + Math.abs(R[4]) * h[1] + Math.abs(R[5]) * h[2],
      Math.abs(R[6]) * h[0] + Math.abs(R[7]) * h[1] + Math.abs(R[8]) * h[2]];
    c.min = [p[0] - e[0], p[1] - e[1], p[2] - e[2]];
    c.max = [p[0] + e[0], p[1] + e[1], p[2] + e[2]];
    c.stamp = 0;
    this.items.push(c);
    const lo = c.min.map((v) => Math.floor(v / CELL)), hi = c.max.map((v) => Math.floor(v / CELL));
    const cells = (hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1);
    if (cells > 400) { this.big.push(c); return; }
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
      const k = hash(x, y, z);
      let a = this.grid.get(k);
      if (!a) this.grid.set(k, (a = []));
      a.push(c);
    }
  }

  highestTopAt(x, z) {
    let best = null;
    for (const c of this.items) {
      if (x < c.min[0] || x > c.max[0] || z < c.min[2] || z > c.max[2]) continue;
      if (best === null || c.max[1] > best) best = c.max[1];
    }
    return best;
  }

  bounds() {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const c of this.items) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], c.min[k]); mx[k] = Math.max(mx[k], c.max[k]); }
    return this.items.length ? { min: mn, max: mx } : null;
  }

  pushOut(p, r) {
    this.maxNy = -1; this.minNy = 1;
    let any = false;
    for (let iter = 0; iter < 3; iter++) {
      const cand = this._candidates(p, r);
      let hit = false;
      for (const c of cand) if (this._test(c, p, r)) hit = true;
      if (!hit) break;
      any = true;
    }
    return any;
  }

  _candidates(p, r) {
    this.stamp++;
    const out = [];
    const add = (c) => { if (c.stamp !== this.stamp) { c.stamp = this.stamp; out.push(c); } };
    for (const c of this.big) add(c);
    const x0 = Math.floor((p[0] - r) / CELL), x1 = Math.floor((p[0] + r) / CELL);
    const y0 = Math.floor((p[1] - r) / CELL), y1 = Math.floor((p[1] + r) / CELL);
    const z0 = Math.floor((p[2] - r) / CELL), z1 = Math.floor((p[2] + r) / CELL);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const a = this.grid.get(hash(x, y, z));
      if (a) for (const c of a) add(c);
    }
    return out;
  }

  _apply(p, nx, ny, nz, depth) {
    p[0] += nx * depth; p[1] += ny * depth; p[2] += nz * depth;
    if (ny > this.maxNy) this.maxNy = ny;
    if (ny < this.minNy) this.minNy = ny;
    return true;
  }

  _test(c, p, r) {
    if (p[0] + r < c.min[0] || p[0] - r > c.max[0] || p[1] + r < c.min[1] || p[1] - r > c.max[1] || p[2] + r < c.min[2] || p[2] - r > c.max[2]) return false;
    const dx = p[0] - c.pos[0], dy = p[1] - c.pos[1], dz = p[2] - c.pos[2];
    if (c.type === 'ball') {
      const d = Math.hypot(dx, dy, dz), rr = r + c.radius;
      if (d >= rr) return false;
      if (d < 1e-6) return this._apply(p, 0, 1, 0, rr);
      return this._apply(p, dx / d, dy / d, dz / d, rr - d);
    }
    const R = c.rot, h = c.half;
    const lx = R[0] * dx + R[3] * dy + R[6] * dz, ly = R[1] * dx + R[4] * dy + R[7] * dz, lz = R[2] * dx + R[5] * dy + R[8] * dz;
    let nlx, nly, nlz, depth;
    if (c.type === 'convex') {
      let best = -Infinity, bn = null;
      for (const pl of c.planes) {
        const d = pl[0] * lx + pl[1] * ly + pl[2] * lz - pl[3];
        if (d >= r) return false;
        if (d > best) { best = d; bn = pl; }
      }
      if (!bn) return false;
      nlx = bn[0]; nly = bn[1]; nlz = bn[2]; depth = r - best;
    } else {
      const qx = Math.max(-h[0], Math.min(h[0], lx)), qy = Math.max(-h[1], Math.min(h[1], ly)), qz = Math.max(-h[2], Math.min(h[2], lz));
      const ex = lx - qx, ey = ly - qy, ez = lz - qz, d2 = ex * ex + ey * ey + ez * ez;
      if (d2 >= r * r) return false;
      if (d2 > 1e-12) { const d = Math.sqrt(d2); nlx = ex / d; nly = ey / d; nlz = ez / d; depth = r - d; }
      else {
        const gx = h[0] - Math.abs(lx), gy = h[1] - Math.abs(ly), gz = h[2] - Math.abs(lz);
        nlx = nly = nlz = 0;
        if (gx <= gy && gx <= gz) { nlx = lx < 0 ? -1 : 1; depth = r + gx; }
        else if (gy <= gz) { nly = ly < 0 ? -1 : 1; depth = r + gy; }
        else { nlz = lz < 0 ? -1 : 1; depth = r + gz; }
      }
    }
    return this._apply(p, R[0] * nlx + R[1] * nly + R[2] * nlz, R[3] * nlx + R[4] * nly + R[5] * nlz, R[6] * nlx + R[7] * nly + R[8] * nlz, depth);
  }
}

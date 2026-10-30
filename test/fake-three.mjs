// テスト専用: Three.jsの最小スタブ。BoxGeometryはthree本体のbuildPlaneと同じ頂点・UV生成を再現する。
export const SRGBColorSpace = 'srgb';
export class BufferAttribute {
  constructor(arr, n) { this.array = arr; this.itemSize = n; this.count = arr.length / n; }
  getX(i) { return this.array[i * this.itemSize]; } getY(i) { return this.array[i * this.itemSize + 1]; }
  getZ(i) { return this.array[i * this.itemSize + 2]; }
}
class Attr {
  constructor(arr, n) { this.array = arr; this.itemSize = n; this.count = arr.length / n; }
  getX(i) { return this.array[i * this.itemSize]; } getY(i) { return this.array[i * this.itemSize + 1]; }
  getZ(i) { return this.array[i * this.itemSize + 2]; }
  setXY(i, x, y) { this.array[i * 2] = x; this.array[i * 2 + 1] = y; }
  setXYZ(i, x, y, z) { const o = i * 3; this.array[o] = x; this.array[o + 1] = y; this.array[o + 2] = z; }
}
export class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  length() { return Math.hypot(this.x, this.y, this.z); }
  divideScalar(s) { this.x /= s; this.y /= s; this.z /= s; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  fromBufferAttribute(a, i) { this.x = a.getX(i); this.y = a.getY(i); this.z = a.getZ(i); return this; }
}
export class BoxGeometry {
  constructor(width = 1, height = 1, depth = 1, wS = 1, hS = 1, dS = 1) {
    const P = [], N = [], U = [];
    const plane = (u, v, w, udir, vdir, W, H, D, gx, gy) => {
      const sw = W / gx, sh = H / gy, wh = W / 2, hh = H / 2, dh = D / 2;
      for (let iy = 0; iy <= gy; iy++) for (let ix = 0; ix <= gx; ix++) {
        const vec = { x: 0, y: 0, z: 0 };
        vec[u] = (ix * sw - wh) * udir; vec[v] = (iy * sh - hh) * vdir; vec[w] = dh;
        P.push(vec.x, vec.y, vec.z);
        const nv = { x: 0, y: 0, z: 0 }; nv[w] = D > 0 ? 1 : -1; N.push(nv.x, nv.y, nv.z);
        U.push(ix / gx, 1 - iy / gy);
      }
    };
    plane('z', 'y', 'x', -1, -1, depth, height, width, dS, hS);
    plane('z', 'y', 'x', 1, -1, depth, height, -width, dS, hS);
    plane('x', 'z', 'y', 1, 1, width, depth, height, wS, dS);
    plane('x', 'z', 'y', 1, -1, width, depth, -height, wS, dS);
    plane('x', 'y', 'z', 1, -1, width, height, depth, wS, hS);
    plane('x', 'y', 'z', -1, -1, width, height, -depth, wS, hS);
    this.attributes = { position: new Attr(new Float32Array(P), 3), normal: new Attr(new Float32Array(N), 3), uv: new Attr(new Float32Array(U), 2) };
    this.attributes.uv.needsUpdate = false;
  }
  dispose() {}
}
export class BufferGeometry {
  constructor() { this.attributes = {}; this.index = null; }
  setAttribute(n, a) { this.attributes[n] = a; return this; }
  setIndex(a) { this.index = a; return this; }
  dispose() {}
}
export class Matrix4 { set(...e) { this.e = e; return this; } }
export class Color { constructor(r, g, b) { this.r = r; this.g = g; this.b = b; } }
export class Texture { constructor(img) { this.image = img; } dispose() {} }
export const DoubleSide = 2;
export class PlaneGeometry { constructor(w, h) { this.w = w; this.h = h; } dispose() {} }
class Mat { constructor(o = {}) { Object.assign(this, o); } dispose() {} }
export class MeshStandardMaterial extends Mat {}
export class MeshBasicMaterial extends Mat {}
export class CanvasTexture { constructor(c) { this.image = c; } dispose() {} }
class Obj {
  constructor() { this.children = []; this.position = new Vector3(); this.rotation = { x: 0, y: 0, z: 0 }; this.visible = true; this.matrix = new Matrix4(); this.matrixAutoUpdate = true; }
  add(c) { this.children.push(c); return this; }
  traverse(f) { f(this); this.children.forEach((c) => c.traverse(f)); }
}
export class Group extends Obj {}
export class Mesh extends Obj { constructor(g, m) { super(); this.geometry = g; this.material = m; } }
export class Box3 {
  setFromObject(o) {
    this.min = new Vector3(Infinity, Infinity, Infinity); this.max = new Vector3(-Infinity, -Infinity, -Infinity);
    o.traverse((m) => { if (m.geometry && m.geometry.attributes) {
      const s = m.geometry.attributes.position; const g = m.geometry; void g;
      for (let i = 0; i < s.count; i++) {
        const x = s.getX(i) + m.position.x, y = s.getY(i) + m.position.y, z = s.getZ(i) + m.position.z;
        this.min.set(Math.min(this.min.x, x), Math.min(this.min.y, y), Math.min(this.min.z, z));
        this.max.set(Math.max(this.max.x, x), Math.max(this.max.y, y), Math.max(this.max.z, z));
      } } });
    return this;
  }
}

// SpecialMesh.MeshType の標準形状(Brick/Sphere/Cylinder/Wedge など)をジオメトリ化する。THREE非依存。
// 返り値は mesh.js と同形式 { positions, normals, uvs, indices, bbox }。Part.Size は頂点に焼き込む(あとは Scale/Offset を掛けるだけ)。

export const MESH_TYPE = { Head: 0, Torso: 1, Wedge: 2, Sphere: 3, Cylinder: 4, FileMesh: 5, Brick: 6,
  Prism: 7, Pyramid: 8, ParallelRamp: 9, RightAngleRamp: 10, CornerWedge: 11 };

/** FileMesh 以外(=メッシュIDを使わず組み込み形状で描くもの) */
export const isPrimitiveType = (t) => Number.isInteger(t) && t !== MESH_TYPE.FileMesh && t >= 0 && t <= 11;

const H = 0.5;
const BOX = [[-H, -H, -H], [H, -H, -H], [H, H, -H], [-H, H, -H], [-H, -H, H], [H, -H, H], [H, H, H], [-H, H, H]];

// 凸多面体: 頂点リスト + 面(頂点番号の多角形)。向きは中心から外向きになるよう自動で揃える
const POLY = {
  box: { v: BOX, f: [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [3, 2, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5]] },
  // 斜面が手前(-Z)を向き、垂直面が奥(+Z)にある楔
  wedge: { v: [[-H, -H, -H], [H, -H, -H], [-H, -H, H], [H, -H, H], [-H, H, H], [H, H, H]],
    f: [[0, 1, 3, 2], [2, 3, 5, 4], [0, 1, 5, 4], [0, 2, 4], [1, 3, 5]] },
  // 底面の1隅の真上に頂点がある三角錐状
  corner: { v: [[-H, -H, -H], [H, -H, -H], [H, -H, H], [-H, -H, H], [H, H, H]],
    f: [[0, 1, 2, 3], [1, 2, 4], [3, 2, 4], [0, 1, 4], [0, 3, 4]] },
  pyramid: { v: [[-H, -H, -H], [H, -H, -H], [H, -H, H], [-H, -H, H], [0, H, 0]],
    f: [[0, 1, 2, 3], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]] },
  // 三角柱(中央に稜線)
  prism: { v: [[-H, -H, -H], [H, -H, -H], [H, -H, H], [-H, -H, H], [0, H, -H], [0, H, H]],
    f: [[0, 1, 2, 3], [0, 1, 4], [3, 2, 5], [0, 3, 5, 4], [1, 2, 5, 4]] },
};

function finish(positions, normals, uvs, indices) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], positions[i + k]); max[k] = Math.max(max[k], positions[i + k]); }
  return { positions: Float32Array.from(positions), normals: Float32Array.from(normals), uvs: Float32Array.from(uvs), indices: Uint32Array.from(indices), bbox: { min, max } };
}

function polyhedron(def) {
  const P = [], N = [], T = [], I = [];
  const c = [0, 0, 0];
  for (const v of def.v) for (let k = 0; k < 3; k++) c[k] += v[k] / def.v.length;
  for (const face of def.f) {
    let vs = face.map((i) => def.v[i]);
    const a = vs[0], b = vs[1], d = vs[2];
    let n = [(b[1] - a[1]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[1] - a[1]), (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]), (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0])];
    const len = Math.hypot(...n) || 1; n = n.map((x) => x / len);
    if (n[0] * (a[0] - c[0]) + n[1] * (a[1] - c[1]) + n[2] * (a[2] - c[2]) < 0) { vs = vs.slice().reverse(); n = n.map((x) => -x); }
    const base = P.length / 3;
    const ax = Math.abs(n[0]) > 0.5 ? 2 : 0; // 支配軸に応じた平面投影UV
    for (const v of vs) { P.push(...v); N.push(...n); T.push(v[ax] + H, H - v[1]); }
    for (let i = 1; i < vs.length - 1; i++) I.push(base, base + i, base + i + 1);
  }
  return finish(P, N, T, I);
}

/** Y軸まわりの回転体。profile=[[半径,y],...](上→下)。区間ごとの面法線(角は立つ) */
function lathe(profile, seg) {
  const P = [], N = [], T = [], I = [];
  for (let s = 0; s < profile.length - 1; s++) {
    const [r0, y0] = profile[s], [r1, y1] = profile[s + 1];
    let nr = y0 - y1, ny = r1 - r0; // 区間の外向き法線(r,y)
    const l = Math.hypot(nr, ny) || 1; nr /= l; ny /= l;
    const base = P.length / 3;
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      P.push(r0 * ca, y0, r0 * sa, r1 * ca, y1, r1 * sa);
      N.push(nr * ca, ny, nr * sa, nr * ca, ny, nr * sa);
      T.push(j / seg, H - y0, j / seg, H - y1);
    }
    for (let j = 0; j < seg; j++) { const o = base + j * 2; I.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
  }
  return finish(P, N, T, I);
}

function sphere(rings = 14, seg = 24) {
  const P = [], N = [], T = [], I = [];
  for (let i = 0; i <= rings; i++) {
    const t = (i / rings) * Math.PI, y = Math.cos(t), r = Math.sin(t);
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2, x = r * Math.cos(a), z = r * Math.sin(a);
      P.push(x * H, y * H, z * H); N.push(x, y, z); T.push(j / seg, i / rings);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
    const a = i * (seg + 1) + j, b = a + seg + 1;
    I.push(a, a + 1, b, a + 1, b + 1, b);
  }
  return finish(P, N, T, I);
}

// Head メッシュの近似: 角を丸めた円柱(1×1×1)
const HEAD_PROFILE = [[0, H], [0.3, H], [0.42, 0.46], [0.5, 0.36], [0.5, -0.36], [0.42, -0.46], [0.3, -H], [0, -H]];

/** 外向き法線の向きを揃えるため、回転体は三角形の向きを逆にして返す(lathe は内向きの面順序になるため) */
function flip(g) {
  for (let i = 0; i < g.indices.length; i += 3) { const t = g.indices[i + 1]; g.indices[i + 1] = g.indices[i + 2]; g.indices[i + 2] = t; }
  return g;
}

/**
 * MeshType の標準形状を生成する。size=Part.Size(焼き込み)。
 * Head は固有サイズ(1×1×1)で Size を無視、ParallelRamp/RightAngleRamp は Wedge で近似する。
 */
export function primitiveGeometry(type, size = [1, 1, 1]) {
  const T = MESH_TYPE;
  let g, s = size.map((v) => v || 1);
  switch (type) {
    case T.Head: g = flip(lathe(HEAD_PROFILE, 24)); s = [1, 1, 1]; break;
    case T.Sphere: g = sphere(); break;
    case T.Cylinder: g = flip(lathe([[0, H], [H, H], [H, -H], [0, -H]], 24)); break;
    case T.Wedge: case T.ParallelRamp: case T.RightAngleRamp: g = polyhedron(POLY.wedge); break;
    case T.CornerWedge: g = polyhedron(POLY.corner); break;
    case T.Pyramid: g = polyhedron(POLY.pyramid); break;
    case T.Prism: g = polyhedron(POLY.prism); break;
    default: g = polyhedron(POLY.box); // Brick / Torso
  }
  const p = g.positions, n = g.normals;
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) { p[i + k] *= s[k]; n[i + k] /= s[k]; }
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  for (let k = 0; k < 3; k++) { g.bbox.min[k] *= s[k]; g.bbox.max[k] *= s[k]; }
  return g;
}

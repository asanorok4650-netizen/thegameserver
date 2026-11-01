// Robloxメッシュ(version 1.xx テキスト / 2.00 / 3.xx / 4.xx / 5.00 / 6.00 チャンク形式 / 7.00 Draco圧縮)のパーサ。THREE非依存。
// v7.00 は Draco のデコードが非同期なので parseMeshAsync を使う(parseMesh は v1〜v6)。スキニング/FACSは読み飛ばす。返り値のUVは「v=0が画像の上」のまま(テクスチャはflipY=falseで使う)。

export class MeshError extends Error {}

const latin1 = (u8) => String.fromCharCode(...u8);

function finish(positions, normals, uvs, indices) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], positions[i + k]); max[k] = Math.max(max[k], positions[i + k]); }
  }
  return { positions, normals, uvs, indices, bbox: { min, max } };
}

function parseV1(u8, ver) {
  const text = new TextDecoder('latin1').decode(u8);
  const nl = text.indexOf('\n');
  const rest = text.slice(nl + 1);
  const nl2 = rest.indexOf('\n');
  const body = rest.slice(nl2 + 1);
  const triples = [...body.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].split(',').map(Number));
  const nv = Math.floor(triples.length / 3);
  if (nv === 0 || nv % 3 !== 0) throw new MeshError('v1メッシュの頂点数が不正です');
  const scale = ver === '1.00' ? 0.5 : 1;
  const positions = new Float32Array(nv * 3), normals = new Float32Array(nv * 3), uvs = new Float32Array(nv * 2);
  for (let i = 0; i < nv; i++) {
    const [p, n, t] = [triples[3 * i], triples[3 * i + 1], triples[3 * i + 2]];
    for (let k = 0; k < 3; k++) { positions[i * 3 + k] = p[k] * scale; normals[i * 3 + k] = n[k]; }
    uvs[i * 2] = t[0]; uvs[i * 2 + 1] = t[1];
  }
  const indices = new Uint32Array(nv);
  for (let i = 0; i < nv; i++) indices[i] = i;
  return finish(positions, normals, uvs, indices);
}

/** FileMeshVertex配列(位置+法線+UV。サイズは36/40)を読む */
function readVertices(dv, off, numVerts, vertexSize) {
  const positions = new Float32Array(numVerts * 3), normals = new Float32Array(numVerts * 3), uvs = new Float32Array(numVerts * 2);
  for (let i = 0; i < numVerts; i++) {
    const o = off + i * vertexSize;
    for (let k = 0; k < 3; k++) { positions[i * 3 + k] = dv.getFloat32(o + 4 * k, true); normals[i * 3 + k] = dv.getFloat32(o + 12 + 4 * k, true); }
    uvs[i * 2] = dv.getFloat32(o + 24, true); uvs[i * 2 + 1] = dv.getFloat32(o + 28, true);
  }
  return { positions, normals, uvs };
}

/** LODオフセット(面番号)から、最高品質メッシュの面範囲 [f0, f1) を決める */
function mainFaceRange(offsets, numFaces) {
  if (offsets && offsets.length >= 2) {
    const f0 = offsets[0], f1 = Math.min(numFaces, offsets[1]);
    if (f1 > f0) return [f0, f1];
  }
  return [0, numFaces];
}

function readIndices(dv, off, f0, f1, numVerts) {
  const indices = new Uint32Array((f1 - f0) * 3);
  for (let i = 0; i < indices.length; i++) {
    const v = dv.getUint32(off + f0 * 12 + i * 4, true);
    if (v >= numVerts) throw new MeshError('面の頂点インデックスが範囲外です');
    indices[i] = v;
  }
  return indices;
}

/** version 6.00 / 7.00: "version X.00\n" の後にチャンク(8バイト種別, u32 版, u32 サイズ, データ)が並ぶ */
function readChunks(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const chunks = {};
  let p = 13;
  while (p + 16 <= u8.length) {
    const type = latin1(u8.subarray(p, p + 8)).replace(/\0+$/, '');
    const ver = dv.getUint32(p + 8, true), size = dv.getUint32(p + 12, true);
    p += 16;
    if (p + size > u8.length) throw new MeshError(`チャンク ${type} が途中で切れています`);
    chunks[type] = { ver, data: u8.subarray(p, p + size) };
    p += size;
  }
  return chunks;
}

/** LODSチャンク: u16 lodType, u8 numHighQualityLODs, u32 numLodOffsets, u32[] (詰め込み。揃えありの場合も試す) */
function readLods(chunk) {
  if (!chunk) return null;
  const d = chunk.data, dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  for (const at of [3, 4]) {
    if (d.length < at + 4) continue;
    const n = dv.getUint32(at, true);
    if (at + 4 + n * 4 === d.length) return Array.from({ length: n }, (_, i) => dv.getUint32(at + 4 + i * 4, true));
  }
  return null;
}

function parseV6(u8) {
  const chunks = readChunks(u8), core = chunks.COREMESH;
  if (!core) throw new MeshError('COREMESHチャンクがありません');
  if (core.ver !== 1) throw new MeshError(`COREMESH の版 ${core.ver} は未対応です`);
  const d = core.data, dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const numVerts = dv.getUint32(0, true);
  for (const vs of [40, 36]) { // 頂点サイズは全体の長さと辻褄が合うほうを採用
    const fOff = 4 + numVerts * vs;
    if (fOff + 4 > d.length) continue;
    const numFaces = dv.getUint32(fOff, true);
    if (fOff + 4 + numFaces * 12 !== d.length) continue;
    const { positions, normals, uvs } = readVertices(dv, 4, numVerts, vs);
    const [f0, f1] = mainFaceRange(readLods(chunks.LODS), numFaces);
    return finish(positions, normals, uvs, readIndices(dv, fOff + 4, f0, f1, numVerts));
  }
  throw new MeshError('COREMESHのサイズが頂点・面の数と一致しません');
}

function computeNormals(positions, indices) {
  const n = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i] * 3, indices[i + 1] * 3, indices[i + 2] * 3];
    const e1 = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
    const e2 = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
    const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) n[v + k] += f[k];
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}

/**
 * version 7.00: COREMESH(版2) の中身が Draco ビットストリーム。
 * decode(bytes) → { positions:Float32Array, normals?:Float32Array, uvs?:Float32Array, indices:Uint32Array }
 * 省略時はブラウザ用デコーダ(three の DRACOLoader)を使う。
 */
async function parseV7(u8, decode) {
  const chunks = readChunks(u8), core = chunks.COREMESH;
  if (!core) throw new MeshError('COREMESHチャンクがありません');
  if (core.ver !== 2) throw new MeshError(`version 7.00 の COREMESH 版 ${core.ver} は未対応です`);
  const dv = new DataView(core.data.buffer, core.data.byteOffset, core.data.byteLength);
  const size = dv.getUint32(0, true);
  if (4 + size > core.data.length) throw new MeshError('Dracoデータが途中で切れています');
  const dec = decode || (await import('./draco.js')).dracoDecode;
  const g = await dec(core.data.slice(4, 4 + size));
  const numVerts = g.positions.length / 3;
  const [f0, f1] = mainFaceRange(readLods(chunks.LODS), g.indices.length / 3);
  const indices = g.indices.slice(f0 * 3, f1 * 3);
  for (const v of indices) if (v >= numVerts) throw new MeshError('面の頂点インデックスが範囲外です');
  return finish(g.positions, g.normals && g.normals.length === g.positions.length ? g.normals : computeNormals(g.positions, indices),
    g.uvs && g.uvs.length === numVerts * 2 ? g.uvs : new Float32Array(numVerts * 2), indices);
}

function parseBinary(u8, major) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const p = 13; // "version X.XX\n"
  const headerSize = dv.getUint16(p, true);
  let vertexSize = 40, numVerts, numFaces, numLods = 0, numBones = 0;
  if (major === 2) {
    vertexSize = u8[p + 2]; numVerts = dv.getUint32(p + 4, true); numFaces = dv.getUint32(p + 8, true);
  } else if (major === 3) {
    vertexSize = u8[p + 2]; numLods = dv.getUint16(p + 6, true);
    numVerts = dv.getUint32(p + 8, true); numFaces = dv.getUint32(p + 12, true);
  } else { // 4, 5
    numVerts = dv.getUint32(p + 4, true); numFaces = dv.getUint32(p + 8, true);
    numLods = dv.getUint16(p + 12, true); numBones = dv.getUint16(p + 14, true);
  }
  if (vertexSize < 32) throw new MeshError(`頂点サイズが不正です (${vertexSize})`);
  const vOff = p + headerSize;
  const skin = major >= 4 && numBones > 0 ? numVerts * 8 : 0;
  const fOff = vOff + numVerts * vertexSize + skin;
  const lodOff = fOff + numFaces * 12;
  if (lodOff > u8.length) throw new MeshError('メッシュデータが途中で切れています');

  const positions = new Float32Array(numVerts * 3), normals = new Float32Array(numVerts * 3), uvs = new Float32Array(numVerts * 2);
  for (let i = 0; i < numVerts; i++) {
    const o = vOff + i * vertexSize;
    for (let k = 0; k < 3; k++) { positions[i * 3 + k] = dv.getFloat32(o + 4 * k, true); normals[i * 3 + k] = dv.getFloat32(o + 12 + 4 * k, true); }
    uvs[i * 2] = dv.getFloat32(o + 24, true); uvs[i * 2 + 1] = dv.getFloat32(o + 28, true);
  }
  // LOD0の面だけ使う
  let f0 = 0, f1 = numFaces;
  if (numLods >= 2 && lodOff + 8 <= u8.length) {
    f0 = dv.getUint32(lodOff, true); f1 = Math.min(numFaces, dv.getUint32(lodOff + 4, true));
    if (f1 <= f0) { f0 = 0; f1 = numFaces; }
  }
  const indices = new Uint32Array((f1 - f0) * 3);
  for (let i = 0; i < indices.length; i++) {
    const v = dv.getUint32(fOff + f0 * 12 + i * 4, true);
    if (v >= numVerts) throw new MeshError('面の頂点インデックスが範囲外です');
    indices[i] = v;
  }
  return finish(positions, normals, uvs, indices);
}

export function parseMesh(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  const head = latin1(u8.subarray(0, 12));
  if (!head.startsWith('version ')) throw new MeshError('Robloxメッシュ形式ではありません');
  const ver = head.slice(8, 12);
  const major = Number(ver[0]);
  if (major === 1) return parseV1(u8, ver);
  if (major >= 2 && major <= 5) return parseBinary(u8, major);
  if (major === 6) return parseV6(u8);
  if (major === 7) throw new MeshError('version 7.00 のメッシュは parseMeshAsync で読み込んでください');
  throw new MeshError(`メッシュ version ${ver} は未対応です`);
}

/** parseMesh の非同期版。v7.00(Draco)にも対応する。 */
export async function parseMeshAsync(input, decode) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (latin1(u8.subarray(0, 12)) === 'version 7.00') return parseV7(u8, decode);
  return parseMesh(u8);
}

// Robloxメッシュ(version 1.xx テキスト / 2.00 / 3.xx / 4.xx / 5.00 バイナリ)のパーサ。THREE非依存。
// 未対応: version 6.xx/7.xx(圧縮メッシュ)。返り値のUVは「v=0が画像の上」のまま(テクスチャはflipY=falseで使う)。

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
  throw new MeshError(`メッシュ version ${ver} は未対応です`);
}

// メッシュ v6.00 / v7.00 と、rbxm の新しいプロパティ型(Content / SecurityCapabilities)の合成データテスト
import assert from 'node:assert/strict';
import * as E from './rbxm-encode.mjs';
import { parseMesh, parseMeshAsync } from '../src/rbx/mesh.js';
import { parseRbxm } from '../src/rbx/rbxm.js';

const te = new TextEncoder();
const f32 = (a) => a.flatMap((f) => E.rawF32(f));
const vert = (p, n, uv, size = 40) => [...f32([...p, ...n, ...uv]), ...[0, 0, 0, 0, 255, 255, 255, 255].slice(0, size - 32)];
const mchunk = (type, ver, data) => [...te.encode(type.padEnd(8, '\0')), ...E.u32(ver), ...E.u32(data.length), ...data];
const header = (v) => [...te.encode(`version ${v}\n`)];

// 2枚の面(4頂点)。LODSで「最初の1枚だけ」が最高品質
const verts = [[0, 0, 0], [1, 0, 0], [0, 2, 0], [1, 2, 3]];
const vbytes = (size) => verts.flatMap((p, i) => vert(p, [0, 0, -1], [i / 4, 0.5], size));
const faces = [0, 1, 2, 1, 3, 2].flatMap((i) => E.u32(i));
for (const vs of [40, 36]) {
  const core = [...E.u32(4), ...vbytes(vs), ...E.u32(2), ...faces];
  const lods = [0, 0, 0, ...E.u32(2), ...E.u32(0), ...E.u32(1)]; // lodType(u16)+hq(u8) | 2個のオフセット [0,1]
  const m = parseMesh(new Uint8Array([...header('6.00'), ...mchunk('COREMESH', 1, core), ...mchunk('LODS', 1, lods)]));
  assert.equal(m.positions.length, 12);
  assert.deepEqual([...m.indices], [0, 1, 2], `v6 頂点${vs} LOD0の面のみ`);
  assert.deepEqual(m.bbox.max, [1, 2, 3]);
}
// LODSなし → 全面
const m6 = parseMesh(new Uint8Array([...header('6.00'), ...mchunk('COREMESH', 1, [...E.u32(4), ...vbytes(40), ...E.u32(2), ...faces])]));
assert.equal(m6.indices.length, 6);

// v7: Draco部分は差し替えデコーダで検証(コンテナ構造とLOD範囲の処理)
const fakeStream = [9, 8, 7, 6, 5];
let got = null;
const decode = async (bytes) => {
  got = [...bytes];
  return { positions: new Float32Array(verts.flat()), normals: null, uvs: new Float32Array(8), indices: Uint32Array.from([0, 1, 2, 1, 3, 2]) };
};
const lods7 = [0, 0, 0, ...E.u32(3), ...E.u32(0), ...E.u32(1), ...E.u32(2)];
const m7 = await parseMeshAsync(new Uint8Array([...header('7.00'),
  ...mchunk('COREMESH', 2, [...E.u32(fakeStream.length), ...fakeStream]), ...mchunk('LODS', 1, lods7)]), decode);
assert.deepEqual(got, fakeStream);
assert.deepEqual([...m7.indices], [0, 1, 2]);
assert.equal(m7.normals.length, 12); // 法線が無い場合は面から計算
assert.throws(() => parseMesh(new Uint8Array([...header('7.00')])), /parseMeshAsync/);

// rbxm: Content(0x22)のURIと SecurityCapabilities(0x21) を読める(警告なし)
const body = {
  content: [...E.encI32s([1]), ...E.u32(1), ...E.str('rbxassetid://123'), ...E.u32(0), ...E.u32(0)],
  caps: [0, 0, 0, 0, 0, 0, 0, 10], // 5 をジグザグ変換した64bit(ビッグエンディアン)
};
const tree = parseRbxm(E.file([
  E.inst(0, 'SpecialMesh', [0]),
  E.prop(0, 'MeshContent', 0x22, body.content),
  E.prop(0, 'Capabilities', 0x21, body.caps),
  E.prnt([0], [-1]),
], 1, 1));
const sm = [...tree.instances.values()][0];
assert.equal(sm.props.MeshContent, 'rbxassetid://123');
assert.equal(sm.props.Capabilities, 5);
assert.deepEqual(tree.warnings, []);
console.log('mesh OK');

// rbxm / LZ4 / メッシュパーサ / アクセサリ配置のテスト(合成データ)
import assert from 'node:assert/strict';
import * as E from './rbxm-encode.mjs';

const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop, set: () => true });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) };

const { lz4Decompress } = await import('../src/rbx/lz4.js');
const { parseRbxm, isBinaryRbxm } = await import('../src/rbx/rbxm.js');
const { parseMesh } = await import('../src/rbx/mesh.js');
const { extractAccessory, parseAssetUri } = await import('../src/rbx/accessory.js');
const { buildAvatar } = await import('../src/avatar/builder.js');
const { DEMOS } = await import('../src/avatar/demo.js');
const { layoutFor, bodyAttachPoint } = await import('../src/avatar/rigs.js');

const approx = (a, b, eps = 1e-5) => Math.abs(a - b) < eps;

// ---- LZ4 ----
{
  const enc = new Uint8Array([0x35, 0x61, 0x62, 0x63, 0x03, 0x00, 0x10, 0x78]); // "abc" + match(off3,len9) + "x"
  assert.equal(new TextDecoder().decode(lz4Decompress(enc, 13)), 'abcabcabcabcx');
  const big = new Uint8Array(1000).map((_, i) => i % 251);
  assert.deepEqual([...lz4Decompress(new Uint8Array(E.lz4Literal([...big])), 1000)], [...big]);
  assert.throws(() => lz4Decompress(enc, 12));
}

// ---- rbxm: Accessory > Handle(MeshPart) > Attachment ----
function makeAccessoryRbxm(compress) {
  const chunks = [
    E.inst(0, 'Accessory', [0]), E.inst(1, 'MeshPart', [1]), E.inst(2, 'Attachment', [2]),
    E.prop(0, 'Name', 1, E.str('TestHat'), compress),
    E.prop(1, 'Name', 1, E.str('Handle'), compress),
    E.prop(1, 'MeshId', 1, E.str('rbxassetid://111'), compress),
    E.prop(1, 'TextureID', 1, E.str('http://www.roblox.com/asset/?id=222'), compress),
    E.prop(1, 'Size', 0x0e, [...E.encF32s([1.5]), ...E.encF32s([0.5]), ...E.encF32s([1.25])], compress),
    E.prop(1, 'Transparency', 4, E.encF32s([0.25]), compress),
    E.prop(1, 'Color3uint8', 0x1a, [255, 128, 0], compress),
    E.prop(1, 'Anchored', 2, [1], compress),
    E.prop(1, 'Unknown', 0x77, [1, 2, 3], compress),
    E.prop(2, 'Name', 1, E.str('HatAttachment'), compress),
    E.prop(2, 'CFrame', 0x10, [0x02, ...E.encF32s([0.5]), ...E.encF32s([-0.25]), ...E.encF32s([0.125])], compress),
    E.prnt([1, 2, 0], [0, 1, -1]),
  ];
  return E.file(chunks, 3, 3);
}
for (const compress of [false, true]) {
  const buf = makeAccessoryRbxm(compress);
  assert.ok(isBinaryRbxm(buf));
  const tree = parseRbxm(buf);
  assert.equal(tree.instances.size, 3);
  assert.equal(tree.roots.length, 1);
  assert.equal(tree.roots[0].className, 'Accessory');
  assert.ok(tree.warnings.some((w) => w.includes('0x77')), '未対応型はwarning');
  const acc = extractAccessory(tree);
  assert.equal(acc.name, 'TestHat');
  assert.equal(acc.handle.kind, 'meshpart');
  assert.deepEqual(acc.handle.size, [1.5, 0.5, 1.25]);
  assert.equal(parseAssetUri(acc.handle.meshUri), 111);
  assert.equal(parseAssetUri(acc.handle.textureUri), 222);
  assert.ok(approx(acc.handle.transparency, 0.25));
  assert.ok(approx(acc.handle.color[0], 1) && approx(acc.handle.color[1], 128 / 255));
  assert.equal(acc.attachment.name, 'HatAttachment');
  assert.deepEqual(acc.attachment.pos.map((v) => +v.toFixed(3)), [0.5, -0.25, 0.125]);
  assert.deepEqual(acc.attachment.rot, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
}
assert.throws(() => parseRbxm(new Uint8Array(40)), /バイナリrbxm/);

// ---- 参照・複数インスタンス・Int/Enum/Vector3/CFrame(id=0) ----
{
  const chunks = [
    E.inst(0, 'Part', [10, 11, 12]),
    E.prop(0, 'Name', 1, [...E.str('a'), ...E.str('b'), ...E.str('c')]),
    E.prop(0, 'Shape', 0x12, E.encU32s([1, 0, 2])),
    E.prop(0, 'Order', 3, E.encI32s([-5, 0, 7])),
    E.prop(0, 'Position', 0x0e, [...E.encF32s([1, 2, 3]), ...E.encF32s([-1, -2, -3]), ...E.encF32s([0, 0.5, 1])]),
    E.prop(0, 'CFrame', 0x10, [0x00, ...[1, 0, 0, 0, 0, -1, 0, 1, 0].flatMap(E.rawF32), 0x03, 0x0d,
      ...E.encF32s([1, 2, 3]), ...E.encF32s([4, 5, 6]), ...E.encF32s([7, 8, 9])]),
    E.prnt([11, 12, 10], [10, 10, -1]),
  ];
  const t = parseRbxm(E.file(chunks, 1, 3));
  const [a, b, c] = [10, 11, 12].map((r) => t.instances.get(r));
  assert.deepEqual([a.props.Name, b.props.Name, c.props.Name], ['a', 'b', 'c']);
  assert.deepEqual([a.props.Shape, b.props.Shape, c.props.Shape], [1, 0, 2]);
  assert.deepEqual([a.props.Order, b.props.Order, c.props.Order], [-5, 0, 7]);
  assert.deepEqual(a.props.Position, [1, -1, 0]);
  assert.deepEqual(b.props.Position, [2, -2, 0.5]);
  assert.deepEqual(c.props.Position, [3, -3, 1]);
  assert.equal(a.children.length, 2);
  assert.deepEqual(t.roots[0].children.map((x) => x.props.Name), ['b', 'c']);
  assert.deepEqual(a.props.CFrame.rot, [1, 0, 0, 0, 0, -1, 0, 1, 0]);
  assert.deepEqual(b.props.CFrame.rot, [1, 0, 0, 0, 0, -1, 0, 1, 0]); // id 0x03
  assert.deepEqual(c.props.CFrame.rot, [0, 1, 0, 0, 0, 1, 1, 0, 0]);  // id 0x0d
  assert.deepEqual(c.props.CFrame.pos, [3, 6, 9]);
}

// ---- メッシュ ----
const f32 = (...v) => v.flatMap(E.rawF32);
const u32le = (...v) => v.flatMap((n) => E.u32(n));
const vtx = (p, n, uv) => [...f32(...p, ...n, ...uv), 0, 0, 0, 0, 255, 255, 255, 255]; // 40バイト
const tri = [vtx([0, 0, 0], [0, 0, 1], [0, 0]), vtx([2, 0, 0], [0, 0, 1], [1, 0]), vtx([0, 4, 0], [0, 0, 1], [0, 1])];
{ // v2.00
  const head = [0x0c, 0x00, 40, 12, ...u32le(3, 1)];
  const m = parseMesh(new Uint8Array([...new TextEncoder().encode('version 2.00\n'), ...head, ...tri.flat(), ...u32le(0, 1, 2)]));
  assert.deepEqual([...m.indices], [0, 1, 2]);
  assert.deepEqual([...m.bbox.max], [2, 4, 0]);
  assert.ok(approx(m.uvs[2], 1) && approx(m.normals[2], 1));
}
{ // v3.00(LOD付き: LOD0は最初の1面だけ)
  const head = [0x10, 0x00, 40, 12, 0x04, 0x00, 0x02, 0x00, ...u32le(3, 2)];
  const verts = [...tri.flat()];
  const faces = u32le(0, 1, 2, 2, 1, 0);
  const lods = u32le(0, 1);
  const m = parseMesh(new Uint8Array([...new TextEncoder().encode('version 3.00\n'), ...head, ...verts, ...faces, ...lods]));
  assert.equal(m.indices.length, 3);
}
{ // v4.00(ボーン付き: スキニング8バイト/頂点を飛ばす)
  const head = [0x18, 0x00, 0, 0, ...u32le(3, 1), 1, 0, 1, 0, ...u32le(0), 0, 0, 0, 0]; // numLods=1,numBones=1,nameTable=0,subsets=0
  const skin = new Array(24).fill(0);
  const m = parseMesh(new Uint8Array([...new TextEncoder().encode('version 4.00\n'), ...head, ...tri.flat(), ...skin, ...u32le(0, 1, 2)]));
  assert.deepEqual([...m.indices], [0, 1, 2]);
}
{ // v1.00 テキスト(位置は0.5倍)
  const txt = 'version 1.00\n1\n[2,0,0][0,0,1][0,0,0][0,4,0][0,0,1][1,0,0][0,0,0][0,0,1][0,1,0]';
  const m = parseMesh(new TextEncoder().encode(txt));
  assert.deepEqual([...m.positions.slice(0, 6)], [1, 0, 0, 0, 2, 0]);
}
assert.throws(() => parseMesh(new TextEncoder().encode('version 7.00\n....')), /未対応/);
assert.throws(() => parseMesh(new TextEncoder().encode('hello world!!!')), /形式ではありません/);

// ---- アクセサリ配置(R6頭のHatAttachment (0,0.6,0) とHandle側アタッチメントを一致させる) ----
for (const rig of ['R6', 'R15']) {
  const demo = buildAvatar(DEMOS.find((d) => d.id === (rig === 'R6' ? 'demo-hat-r6' : 'demo-hat-r15')).make());
  const hat = demo.parts.find((p) => p.accessory);
  assert.ok(hat && !hat.error, `${rig} アクセサリが組み立てられる`);
  const e = hat.object.matrix.e; // [r00 r01 r02 x, r10 ..., ty はe[7]]
  const head = layoutFor(rig).find((p) => p.name === 'Head');
  const k = rig === 'R6' ? 1 : head.size[1] / 1.2;
  // handle側アタッチメント(0,-0.3,0) → ボディ(head中心+0.6k) と一致 → ハンドル原点 y = head.y + 0.6k + 0.3
  assert.ok(approx(e[7], head.center[1] + 0.6 * k + 0.3, 1e-4), `${rig} 帽子のy=${e[7]}`);
  assert.ok(approx(e[3], 0) && approx(e[11], 0));
  assert.ok(demo.box.max.y > head.center[1] + 0.6, 'アクセサリ分だけ高さが増える');
}
// 回転つきアタッチメントの逆変換: Y軸まわり90°回転(rot = [0,0,1, 0,1,0, -1,0,0])
{
  const rot = [0, 0, 1, 0, 1, 0, -1, 0, 0], pos = [1, 0, 0];
  const d = DEMOS.find((x) => x.id === 'demo-hat-r6').make();
  d.accessories[0].attachment = { name: 'HatAttachment', pos, rot };
  const e = buildAvatar(d).parts.find((p) => p.accessory).object.matrix.e;
  const body = bodyAttachPoint('R6', layoutFor('R6'), 'HatAttachment').pos;
  // M*attachLocal = body: R^T * (R*p + t...) の検証 → M * (pos) の位置 = body、M の回転 = R^T
  const rt = [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10]];
  assert.deepEqual(rt.map(Math.round), [0, 0, -1, 0, 1, 0, 1, 0, 0]);
  const tx = e[0] * pos[0] + e[1] * pos[1] + e[2] * pos[2] + e[3];
  const tz = e[8] * pos[0] + e[9] * pos[1] + e[10] * pos[2] + e[11];
  assert.ok(approx(tx, body[0]) && approx(tz, body[2]), 'アタッチメント位置がボディ側と一致');
}
console.log('rbxm OK');

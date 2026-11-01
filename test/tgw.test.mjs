// .tgw: 変換(ツリー→world.json)・検証・ZIPコンテナのテスト
import assert from 'node:assert/strict';
import { treeToWorldJson, worldBounds } from '../src/tgw/worldjson.js';
import { createManifest } from '../src/tgw/manifest.js';
import { validateEntries, validateManifest, validateWorld, checkEntryPath, hasZipMagic, LIMITS } from '../src/tgw/validate.js';

// ---- 合成ツリー ----
const I = (ref, className, props = {}, children = []) => ({ ref, className, props, children, parent: null });
const ident = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const base = I(2, 'Part', { Name: 'Baseplate', Size: [512, 1, 512], CFrame: { pos: [0, -0.5, 0], rot: ident }, Color3uint8: [107, 142, 78], Transparency: 0, CanCollide: true });
const spawn = I(3, 'SpawnLocation', { Name: 'Spawn', Size: [6, 1, 6], CFrame: { pos: [0, 5, 0], rot: ident }, BrickColor: 194 });
const mesh = I(4, 'MeshPart', { Size: [2, 2, 2], CFrame: { pos: [10, 2, 0], rot: ident }, Color3: [1, 0, 0], Transparency: 0.5, CanCollide: false });
const wedge = I(5, 'WedgePart', { Size: [4, 4, 4], CFrame: { pos: [0, 2, 10], rot: ident } });
const ball = I(6, 'Part', { Shape: 0, Size: [3, 3, 3], CFrame: { pos: [0, 2, -10], rot: ident } });
const bad = I(7, 'Part', { Size: [0, 1, 1], CFrame: { pos: [0, 0, 0], rot: ident } });
const script = I(8, 'Script');
const terrain = I(9, 'Terrain');
const ws = I(1, 'Workspace', {}, [base, spawn, mesh, wedge, ball, bad, script, terrain]);
const tree = { instances: new Map([ws, base, spawn, mesh, wedge, ball].map((n) => [n.ref, n])), roots: [ws], warnings: [] };

const { worldJson, report } = treeToWorldJson(tree);
assert.equal(worldJson.parts.length, 5, 'サイズ0のパーツは捨てる');
assert.deepEqual(report.ignored, { Script: 1, Terrain: 1 });
assert.deepEqual(report.approx, { MeshPart: 1 });
assert.equal(report.spawnFound, true);
const byName = Object.fromEntries(worldJson.parts.map((p) => [p.name, p]));
assert.equal(byName.Baseplate.color, '#6b8e4e');
assert.equal(byName.Baseplate.shape, 'block');
assert.equal(byName.MeshPart.color, '#ff0000');
assert.equal(byName.MeshPart.approx, true);
assert.equal(byName.MeshPart.collide, false);
assert.equal(byName.MeshPart.transparency, 0.5);
assert.equal(byName.WedgePart.shape, 'wedge');
assert.equal(byName.Part.shape, 'ball');
assert.match(byName.Spawn.color, /^#[0-9a-f]{6}$/, 'BrickColorも#rrggbbになる');
assert.deepEqual(worldJson.spawns, [{ pos: [0, 5, 0], size: [6, 1, 6] }]);
assert.deepEqual(new Set(worldJson.parts.map((p) => p.id)).size, 5, 'idは一意');

const b = worldBounds(worldJson);
assert.equal(b.min[0], -256);
assert.equal(b.max[1], 5.5);

// ---- manifest / world の検証 ----
const manifest = createManifest(worldJson, report, { name: 'Test', logic: { id: 'obby', params: { killY: -200 } }, sourceName: 't.rbxl' });
assert.equal(manifest.world.partCount, 5);
assert.deepEqual(manifest.source.ignored, { Script: 1, Terrain: 1 });
validateManifest(manifest);
validateWorld(worldJson, manifest);
// JSONを通しても同じ(実際のファイルと同じ経路)
validateWorld(JSON.parse(JSON.stringify(worldJson)), JSON.parse(JSON.stringify(manifest)));

// マイナーバージョンと未知フィールドは無視して読める。メジャー違いは拒否
validateManifest({ ...manifest, formatVersion: '1.7', futureField: 1 });
assert.throws(() => validateManifest({ ...manifest, formatVersion: '2.0' }), /対応していません/);
assert.throws(() => validateWorld({ ...worldJson, formatVersion: '2.0' }, manifest), /対応していません/);

// パーツ数の不一致・非有限値・不正な形
assert.throws(() => validateWorld(worldJson, { ...manifest, world: { ...manifest.world, partCount: 4 } }), /パーツ数/);
const clone = () => JSON.parse(JSON.stringify(worldJson));
{ const w = clone(); w.parts[0].pos[1] = null; assert.throws(() => validateWorld(w, manifest), /pos/); }
{ const w = clone(); w.parts[0].size[0] = 0; assert.throws(() => validateWorld(w, manifest), /size/); }
{ const w = clone(); w.parts[0].rot = [1, 0, 0]; assert.throws(() => validateWorld(w, manifest), /rot/); }
{ const w = clone(); w.parts[0].shape = 'torus'; assert.throws(() => validateWorld(w, manifest), /shape/); }
{ const w = clone(); w.parts[1].id = w.parts[0].id; assert.throws(() => validateWorld(w, manifest), /重複/); }
{ const w = clone(); w.parts[0].color = 'red'; assert.throws(() => validateWorld(w, manifest), /color/); }
assert.throws(() => validateManifest({ ...manifest, name: '' }), /name/);
assert.throws(() => validateManifest({ ...manifest, players: { max: 0 } }), /players.max/);
assert.throws(() => validateManifest({ ...manifest, world: { file: '../world.json' } }), /\.\./);

// ---- パス・エントリ上限 ----
for (const bad of ['../x', 'a/../b', '/abs', 'C:/x', 'a\\b', '']) assert.throws(() => checkEntryPath(bad), undefined, bad);
checkEntryPath('assets/tex/a.png');
assert.throws(() => validateEntries([{ name: 'world.json', size: 1 }]), /manifest\.json/);
assert.throws(() => validateEntries([{ name: 'manifest.json', size: 1 }, { name: 'manifest.json', size: 1 }]), /重複/);
assert.throws(() => validateEntries([{ name: 'manifest.json', size: 1 }, { name: 'big.bin', size: LIMITS.maxTotalUnpacked }]), /合計サイズ/);
assert.throws(() => validateEntries(Array.from({ length: LIMITS.maxEntries + 1 }, (_, i) => ({ name: 'f' + i, size: 1 }))), /エントリ数/);
assert.equal(validateEntries([{ name: 'manifest.json', size: 10 }, { name: 'world.json', size: 10 }]), true);
assert.equal(hasZipMagic(new Uint8Array([0x50, 0x4b, 3, 4, 0])), true);
assert.equal(hasZipMagic(new Uint8Array([0x3c, 0x72, 0x6f, 0x62])), false);

// ---- ZIPコンテナ(fflateが入っている環境でのみ) ----
let fflateOk = true;
try { await import('fflate'); } catch { fflateOk = false; }
if (!fflateOk) {
  console.log('tgw.test: fflate が見つからないため ZIP の読み書きテストはスキップ(npm install 後に実行されます)');
} else {
  const { buildTgw, readTgw, readEntry } = await import('../src/tgw/container.js');
  const { zipSync, strToU8 } = await import('fflate');
  const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
  const bytes = buildTgw({ manifest, worldJson, files: { 'thumbnail.png': png, 'assets/a.png': png } });
  assert.equal(hasZipMagic(bytes), true);
  const r = readTgw(bytes);
  assert.deepEqual(r.worldJson, worldJson);
  assert.equal(r.manifest.name, 'Test');
  assert.deepEqual([...readEntry(bytes, r.entries, 'thumbnail.png')], [...png]);
  assert.throws(() => readEntry(bytes, r.entries, 'nope.bin'), /ありません/);

  // 圧縮: world.json はdeflate、pngはstore
  const { unzipSync } = await import('fflate');
  const info = {}; unzipSync(bytes, { filter: (f) => { info[f.name] = f.compression; return false; } });
  assert.equal(info['world.json'], 8);
  assert.equal(info['thumbnail.png'], 0);

  // 壊れた/危険なZIP
  assert.throws(() => readTgw(strToU8('not a zip')), /ZIP/);
  assert.throws(() => readTgw(zipSync({ 'world.json': strToU8('{}') })), /manifest\.json/);
  assert.throws(() => readTgw(zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), '../evil': strToU8('x') })), /\.\./);
  assert.throws(() => readTgw(zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)) })), /world\.json/);
  assert.throws(() => readTgw(zipSync({ 'manifest.json': strToU8('{oops'), 'world.json': strToU8('{}') })), /JSON/);
  const short = { ...worldJson, parts: worldJson.parts.slice(1) };
  assert.throws(() => readTgw(zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), 'world.json': strToU8(JSON.stringify(short)) })), /パーツ数/);
}

console.log('tgw.test: OK');

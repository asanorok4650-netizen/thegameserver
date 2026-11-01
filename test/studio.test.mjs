// Studio: ドキュメントモデル・履歴・ピッキング(THREE/DOM不要)
import assert from 'node:assert/strict';
import {
  createDoc, createStarterDoc, addPart, updateParts, movePartsBy, removeParts, duplicateParts,
  addSpawn, removeSpawn, setMeta, checkDoc, docToPackage, docFromPackage, yawOf, rotY, IDENT, eulerToRot, rotToEuler
} from '../src/studio/model.js';
import { createHistory, commit, undo, redo, canUndo, canRedo, markSaved, isDirty } from '../src/studio/history.js';
import { rayVsPart, pickPart, rayVsPlaneY, snap } from '../src/studio/pick.js';
import { validateManifest, validateWorld } from '../src/tgw/validate.js';

// ---- モデル ----
let d = createStarterDoc('T');
assert.equal(d.parts.length, 1);
assert.equal(d.spawns.length, 1);
assert.equal(d.nextId, 2);

const r = addPart(d, { name: 'A', size: [2, 2, 2], pos: [10, 1, 0], color: '#FF0000' });
assert.equal(r.id, 'p2');
assert.equal(r.doc.parts[1].color, '#ff0000', '色は小文字に正規化');
assert.equal(d.parts.length, 1, '元のdocは変わらない(不変)');
d = r.doc;

// 不正値は無視して元の値を残す
const bad = updateParts(d, ['p2'], { size: [0, 1, 1], color: 'red', pos: [NaN, 5, 5], shape: 'torus', transparency: 9, rot: [1, 2] });
assert.deepEqual(bad.parts[1].size, [2, 1, 1].map((v, i) => (i === 0 ? 2 : v)), 'sizeの0は元の値に戻る');
assert.equal(bad.parts[1].color, '#ff0000');
assert.deepEqual(bad.parts[1].pos, [10, 5, 5], 'NaNの成分だけ元の値');
assert.equal(bad.parts[1].shape, 'block');
assert.equal(bad.parts[1].transparency, 1, '範囲外は丸める');
assert.deepEqual(bad.parts[1].rot, IDENT);
assert.equal(updateParts(d, ['p2'], { color: 'red' }), d, '変化なしなら同じ参照を返す');
assert.equal(updateParts(d, ['zzz'], { color: '#00ff00' }), d);

const moved = movePartsBy(d, ['p2'], [1, 2, 3]);
assert.deepEqual(moved.parts[1].pos, [11, 3, 3]);
assert.deepEqual(d.parts[1].pos, [10, 1, 0]);

const dup = duplicateParts(d, ['p2']);
assert.equal(dup.ids.length, 1);
assert.notEqual(dup.ids[0], 'p2');
assert.equal(dup.doc.parts.length, 3);
assert.deepEqual(dup.doc.parts[2].pos, [12, 1, 2]);

// 削除してもidは再利用しない
const afterDel = removeParts(dup.doc, ['p3']);
assert.equal(afterDel.parts.length, 2);
assert.equal(addPart(afterDel, {}).id, 'p4');
assert.equal(removeParts(d, ['none']), d);

// スポーン・メタ
d = addSpawn(d, { pos: [1, 2, 3] });
assert.equal(d.spawns.length, 2);
assert.equal(removeSpawn(d, 0).spawns.length, 1);
const m = setMeta(d, { name: 'X', players: { max: 100, sendHz: 20 } });
assert.equal(m.name, 'X');
assert.equal(m.players.max, 8, '範囲外の人数は無視');
assert.equal(m.players.sendHz, 20);

// 取り込んだdocのidと採番
const imp = createDoc({ parts: [{ id: 'p7', name: 'q', shape: 'block', size: [1, 1, 1], pos: [0, 0, 0], rot: IDENT.slice(), color: '#000000', transparency: 0, collide: true, tags: [], attrs: {} }] });
assert.equal(imp.nextId, 8);

// ---- 公開前チェック ----
assert.ok(checkDoc(createDoc({ name: 'E' })).errors.length > 0, '空のワールドは公開不可');
assert.deepEqual(checkDoc(d).errors, []);
assert.ok(checkDoc(createDoc({ name: 'S', parts: d.parts })).warnings.some((w) => /スポーン/.test(w)));
assert.ok(checkDoc({ ...d, source: { ignored: { Terrain: 1 } } }).warnings.some((w) => /Terrain/.test(w)));

// ---- docToPackage は tgw の検証を通る / 往復で同じ ----
const pkg = docToPackage({ ...d, logic: { id: 'obby', version: 1, params: { killY: -100 } } });
validateManifest(pkg.manifest);
validateWorld(JSON.parse(JSON.stringify(pkg.worldJson)), JSON.parse(JSON.stringify(pkg.manifest)));
assert.equal(pkg.manifest.world.partCount, d.parts.length);
assert.equal(pkg.manifest.logic.id, 'obby');
assert.equal(pkg.manifest.generator, 'thegameserver-studio');
const back = docFromPackage({ manifest: pkg.manifest, worldJson: pkg.worldJson, format: 'tgw' });
assert.deepEqual(back.parts, d.parts);
assert.deepEqual(back.spawns, d.spawns);
assert.equal(back.logic.id, 'obby');
pkg.worldJson.parts[0].pos[0] = 999;
assert.notEqual(d.parts[0].pos[0], 999, 'パッケージを変えてもdocは汚れない');

// rbxl由来の source は manifest に残る
const withSrc = docToPackage({ ...d, source: { kind: 'rbxl', name: 'a.rbxl', ignored: { Script: 3 }, approx: {} } });
assert.deepEqual(withSrc.manifest.source.ignored, { Script: 3 });

// 回転ヘルパー
assert.equal(yawOf(IDENT), 0);
assert.equal(yawOf(rotY(90)), 90);
assert.equal(yawOf(rotY(-45)), -45);
assert.equal(yawOf([1, 0, 0, 0, 0, -1, 0, 1, 0]), null, '複合回転はnull');

// 3軸の回転: Y単独は rotY と一致 / 往復で元の角度に戻る / 行列は直交
const close = (a, b, e = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) < e);
assert.ok(close(eulerToRot(0, 33, 0), rotY(33)));
assert.ok(close(eulerToRot(0, 0, 0), IDENT));
for (const e of [[10, 20, 30], [-45, 120, -80], [89, -170, 15], [0, 0, 90], [-30, 0, 0]]) {
  const rt = rotToEuler(eulerToRot(...e));
  assert.ok(close(rt, e, 0.011), `往復 ${e} → ${rt}`);
}
{ // 真上を向く(X=90°)でも、同じ向きの行列に戻る
  const m = eulerToRot(90, 25, 40), back = eulerToRot(...rotToEuler(m));
  assert.ok(close(m, back, 1e-3), 'ジンバル付近でも同じ向き');
}
{ // R * Rᵀ = I(回転行列として正しい)
  const m = eulerToRot(15, 50, -70);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const dot = m[i * 3] * m[j * 3] + m[i * 3 + 1] * m[j * 3 + 1] + m[i * 3 + 2] * m[j * 3 + 2];
    assert.ok(Math.abs(dot - (i === j ? 1 : 0)) < 1e-9);
  }
}
assert.equal(yawOf(eulerToRot(0, 60, 0)), 60);

// ---- 履歴 ----
let h = createHistory(createStarterDoc('H'), { coalesceMs: 1000 });
const base = h.present;
assert.equal(isDirty(h), false);
h = commit(h, addPart(h.present, {}).doc, { now: 0 });
h = commit(h, addPart(h.present, {}).doc, { now: 10 });
assert.equal(h.past.length, 2);
assert.equal(isDirty(h), true);
h = undo(h); h = undo(h);
assert.equal(h.present, base, '2回戻すと最初のdocに戻る(同じ参照)');
assert.equal(canUndo(h), false);
assert.equal(canRedo(h), true);
h = redo(h);
assert.equal(h.present.parts.length, 2);
h = commit(h, addPart(h.present, {}).doc, { now: 20 });
assert.equal(canRedo(h), false, '新しい操作でredoは消える');
assert.equal(commit(h, h.present), h, '変化なしは履歴に積まない');

// 同じキーの連続操作は1つにまとめる
let c = createHistory(createStarterDoc('C'), { coalesceMs: 600 });
const orig = c.present;
for (let i = 0; i < 5; i++) c = commit(c, movePartsBy(c.present, ['p1'], [1, 0, 0]), { key: 'nudge', now: i * 100 });
assert.equal(c.past.length, 1, '連打は1回のundoで戻る');
assert.equal(c.present.parts[0].pos[0], 5);
assert.equal(undo(c).present, orig);
c = commit(c, movePartsBy(c.present, ['p1'], [1, 0, 0]), { key: 'nudge', now: 5000 });
assert.equal(c.past.length, 2, '間が空いたら別の履歴');
c = commit(c, movePartsBy(c.present, ['p1'], [0, 1, 0]), { key: 'other', now: 5010 });
assert.equal(c.past.length, 3, 'キーが違えば別の履歴');

// 履歴の上限
let lim = createHistory(createStarterDoc('L'), { limit: 3 });
for (let i = 0; i < 10; i++) lim = commit(lim, addPart(lim.present, {}).doc, { now: i });
assert.equal(lim.past.length, 3);

// 保存印
let sv = createHistory(createStarterDoc('S'));
sv = commit(sv, addPart(sv.present, {}).doc);
assert.equal(isDirty(sv), true);
sv = markSaved(sv);
assert.equal(isDirty(sv), false);
sv = undo(sv);
assert.equal(isDirty(sv), true, '保存後に戻したらdirty');

// ---- ピッキング ----
const box = { id: 'a', size: [2, 2, 2], pos: [0, 0, 0], rot: IDENT };
assert.equal(rayVsPart([0, 0, 10], [0, 0, -1], box), 9, '正面から: 手前の面まで9');
assert.equal(rayVsPart([0, 0, 10], [0, 0, 1], box), null, '後ろ向きは当たらない');
assert.equal(rayVsPart([5, 0, 10], [0, 0, -1], box), null, '外れ');
assert.equal(rayVsPart([0, 0, 0], [0, 0, -1], box), 1, '箱の中からは出口');
assert.equal(rayVsPart([0, 5, 0], [0, 0, -1], box), null, '平行で箱の外');
// 45度回転した幅2の箱: 角は半径√2
const yawed = { ...box, rot: rotY(45) };
assert.ok(Math.abs(rayVsPart([0, 0, 10], [0, 0, -1], yawed) - (10 - Math.SQRT2)) < 1e-9);
// 菱形になるので、x=0.95 では面が奥に引っ込む(回転前は t=9、回転後は √2-0.95 だけ手前の面が下がる)
assert.equal(rayVsPart([0.95, 0, 10], [0, 0, -1], box), 9);
assert.ok(Math.abs(rayVsPart([0.95, 0, 10], [0, 0, -1], yawed) - (10 - (Math.SQRT2 - 0.95))) < 1e-9);
assert.equal(rayVsPart([1.45, 0, 10], [0, 0, -1], yawed), null, '菱形の頂点(√2)より外は外れ');
// 手前のものを選ぶ・ignore
const near = { ...box, id: 'near', pos: [0, 0, 5] };
assert.equal(pickPart([box, near], [0, 0, 20], [0, 0, -1]).id, 'near');
assert.equal(pickPart([box, near], [0, 0, 20], [0, 0, -1], { ignore: new Set(['near']) }).id, 'a');
assert.equal(pickPart([box], [0, 10, 0], [0, 1, 0]), null);
assert.deepEqual(rayVsPlaneY([0, 10, 0], [1, -1, 0], 0), [10, 0, 0]);
assert.equal(rayVsPlaneY([0, 10, 0], [0, 1, 0], 0), null);
assert.equal(snap(1.4, 1), 1);
assert.equal(snap(1.6, 0.5), 1.5);
assert.equal(snap(1.23, 0), 1.23);

console.log('studio.test: OK');

// 物理ルール・環境・振る舞い部品・動くパーツ(spinner/mover)・足場検出のテスト(THREE非依存)
import assert from 'node:assert/strict';
import { resolveRules, defaultRules, resolveEnvironment, defaultEnvironment, diffFromDefault, RULE_FIELDS, ENV_FIELDS } from '../src/game/rules.js';
import { resolveBehavior, setBehavior, poseAt, BEHAVIORS, isMotion, axisRot } from '../src/behaviors/index.js';
import { Dynamics } from '../src/game/dynamics.js';
import { CollisionWorld } from '../src/game/collision.js';
import { normalizeDoc, createDoc, setRules, setEnvironment, setPartBehavior, setPartBehaviorParam, addPart, docToPackage, docFromPackage } from '../src/studio/model.js';
import { validateManifest, validateWorld } from '../src/tgw/validate.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const closeArr = (a, b, eps = 1e-9) => a.forEach((v, i) => close(v, b[i], eps));
const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// ---- rules ----
assert.deepEqual(resolveRules(undefined), { walkSpeed: 16, jumpPower: 50, gravity: 196.2 });
assert.deepEqual(resolveRules({ walkSpeed: 999, jumpPower: -5, gravity: 'x', extra: 1 }), { walkSpeed: 100, jumpPower: 0, gravity: 196.2 });
assert.deepEqual(resolveRules([1, 2]), defaultRules(), '配列は無視');
assert.equal(resolveRules({ walkSpeed: NaN }).walkSpeed, 16);
assert.equal(diffFromDefault(defaultRules(), RULE_FIELDS), null, '既定値のままなら省く');
assert.deepEqual(diffFromDefault({ ...defaultRules(), gravity: 50 }, RULE_FIELDS), { gravity: 50 });

// ---- environment ----
assert.deepEqual(resolveEnvironment(undefined), defaultEnvironment());
const env = resolveEnvironment({ skyColor: '#ABCDEF', ambient: 99, fogColor: 'red', fogNear: 500, fogFar: 100 });
assert.equal(env.skyColor, '#abcdef');
assert.equal(env.ambient, 4);
assert.equal(env.fogColor, ENV_FIELDS.fogColor.default, '不正な色は既定値');
assert.ok(env.fogNear < env.fogFar, 'near < far を保つ');
assert.equal(resolveEnvironment({ fogNear: 500, fogFar: 0 }).fogNear, 500, 'fogFar=0(霧なし)ならそのまま');

// ---- behaviors ----
assert.equal(resolveBehavior(undefined), null);
assert.equal(resolveBehavior({}), null);
assert.equal(resolveBehavior({ behavior: 'teleporter' }), null, '未知の振る舞いは無視');
assert.deepEqual(resolveBehavior({ behavior: 'spinner' }).params, { axis: 'y', speed: 90 });
assert.deepEqual(resolveBehavior({ behavior: 'spinner', axis: 'q', speed: 99999 }).params, { axis: 'y', speed: 720 });
assert.equal(resolveBehavior({ behavior: 'bounce', power: 1 }).params.power, 10);
assert.equal(resolveBehavior({ behavior: 'mover', period: 0 }).params.period, 0.5, '周期0でも割り算で壊れない');
assert.equal(setBehavior({ keep: 1 }, 'bounce').power, 100);
{
  const a = setBehavior({ keep: 1, label: 'x' }, 'spinner');
  assert.deepEqual(a, { keep: 1, label: 'x', behavior: 'spinner', axis: 'y', speed: 90 });
  const b = setBehavior(a, 'conveyor');
  assert.deepEqual(b, { keep: 1, label: 'x', behavior: 'conveyor', speed: 16 }, '前の部品のパラメータだけ消える');
  assert.deepEqual(setBehavior(b, ''), { keep: 1, label: 'x' });
  assert.deepEqual(setBehavior({ speed: 5 }, ''), { speed: 5 }, '振る舞いが無ければ他のattrsは触らない');
}
assert.ok(isMotion(resolveBehavior({ behavior: 'mover' })) && !isMotion(resolveBehavior({ behavior: 'bounce' })) && !isMotion(null));

// poseAt
const base = { pos: [10, 5, 0], rot: I };
const spin = resolveBehavior({ behavior: 'spinner', axis: 'y', speed: 90 });
closeArr(poseAt(base, spin, 0).rot, I);
closeArr(poseAt(base, spin, 1).rot, axisRot('y', Math.PI / 2));
closeArr(poseAt(base, spin, 4).rot, I, 1e-9);
assert.deepEqual(poseAt(base, spin, 3).pos, [10, 5, 0], '回転は位置を変えない');
const mv = resolveBehavior({ behavior: 'mover', dx: 0, dy: 10, dz: 4, period: 4 });
closeArr(poseAt(base, mv, 0).pos, [10, 5, 0]);
closeArr(poseAt(base, mv, 2).pos, [10, 15, 4]);
closeArr(poseAt(base, mv, 4).pos, [10, 5, 0]);
closeArr(poseAt(base, mv, 1).pos, poseAt(base, mv, 3).pos, 1e-9);
assert.deepEqual(base.pos, [10, 5, 0], 'baseを書き換えない');
assert.deepEqual(poseAt(base, resolveBehavior({ behavior: 'bounce' }), 9).pos, [10, 5, 0]);
assert.deepEqual(poseAt(base, mv, 2), poseAt(base, mv, 2), '同じtなら同じ姿勢(マルチプレイで揃う)');

// ---- 衝突: 足場の検出 / moveItem ----
const col = new CollisionWorld();
const floor = { type: 'box', pos: [0, 0, 0], rot: I.slice(), half: [10, 0.5, 10] };
const wall = { type: 'box', pos: [20, 5, 0], rot: I.slice(), half: [0.5, 5, 10] };
col.add(floor); col.add(wall);
const standing = [0, 0.3, 0];
assert.equal(col.pushOutCapsule(standing, 0.9, 0.9, 4.4), true);
assert.equal(col.groundItem, floor, '足元の床が groundItem');
const nearWall = [19, 5, 0]; // 箱の外側の近く(以前は best.d が無くて落ちた)
col.pushOutCapsule(nearWall, 0.9, 0.9, 4.4);
assert.equal(col.groundItem, null, '壁(横向きの法線)は足場にならない');
const free = [50, 50, 50];
assert.equal(col.pushOutCapsule(free, 0.9, 0.9, 4.4), false);
col.moveItem(floor, [100, 0, 0], null);
assert.deepEqual(floor.min, [90, -0.5, -10]);
assert.deepEqual(floor.max, [110, 0.5, 10]);
const old = [0, 0.3, 0];
assert.equal(col.pushOutCapsule(old, 0.9, 0.9, 4.4), false, '動いた後、元の位置には何も無い');
col.moveItem(floor, [0, 0, 0], axisRot('z', Math.PI / 2));
close(floor.max[0], 0.5); close(floor.max[1], 10);

// ---- Dynamics: 動く床がプレイヤーを運ぶ ----
{
  const c = new CollisionWorld();
  const item = { type: 'box', pos: [0, 0, 0], rot: I.slice(), half: [5, 0.5, 5] };
  c.add(item);
  const d = new Dynamics(c);
  const applied = [];
  d.add({ base: { pos: [0, 0, 0], rot: I }, behavior: resolveBehavior({ behavior: 'mover', dx: 10, dy: 0, dz: 0, period: 4 }), item, apply: (p) => applied.push(p.pos[0]) });
  assert.equal(d.size, 1);
  const player = { x: 1, y: 0.5, z: 2 };
  d.step(1, item, player); // t=1: s=0.5 → 5
  close(player.x, 1 + 5); close(player.z, 2);
  close(item.pos[0], 5, 1e-9);
  close(item.min[0], 0, 1e-9);
  d.step(2, null, player); // 乗っていなければ運ばない
  close(player.x, 6);
  close(item.pos[0], 10, 1e-9);
  assert.equal(applied.length, 2);
  d.step(2, item, null); // playerなしでも落ちない
}
{
  const c = new CollisionWorld();
  const item = { type: 'box', pos: [0, 0, 0], rot: I.slice(), half: [5, 0.5, 5] };
  c.add(item);
  const d = new Dynamics(c);
  const trigger = { pos: [0, 0, 0], rot: I.slice() };
  d.add({ base: { pos: [0, 0, 0], rot: I }, behavior: resolveBehavior({ behavior: 'spinner', axis: 'y', speed: 90 }), item, trigger });
  const player = { x: 3, y: 0.5, z: 0 };
  const dyaw = d.step(1, item, player); // 1秒で90度
  close(dyaw, Math.PI / 2);
  close(player.x, 0, 1e-9); close(player.z, -3, 1e-9); // 床と同じ向きに回る
  closeArr(item.rot, axisRot('y', Math.PI / 2));
  closeArr(trigger.rot, axisRot('y', Math.PI / 2));
  // 回転後の箱の外接AABBは正方形なので変わらない
  close(item.max[0], 5, 1e-9);
  // X軸まわりは運ばない
  const d2 = new Dynamics(c);
  d2.add({ base: { pos: [0, 0, 0], rot: I }, behavior: resolveBehavior({ behavior: 'spinner', axis: 'x', speed: 90 }), item });
  const q = { x: 3, y: 0.5, z: 0 };
  assert.equal(d2.step(1, item, q), 0);
  assert.deepEqual([q.x, q.y, q.z], [3, 0.5, 0]);
}

// ---- Studioモデル: rules / environment / behavior の往復 ----
{
  let doc = createDoc({ name: 'W' });
  assert.deepEqual(doc.rules, defaultRules());
  let pk = docToPackage(doc);
  assert.equal(pk.manifest.rules, undefined, '既定値のままならmanifestに書かない');
  assert.equal(pk.worldJson.environment, undefined);
  doc = setRules(doc, { walkSpeed: 30, gravity: 9999 });
  doc = setEnvironment(doc, { skyColor: '#112233', fogFar: 300 });
  assert.equal(doc.rules.gravity, 600, '丸められる');
  pk = docToPackage(doc);
  assert.deepEqual(pk.manifest.rules, { walkSpeed: 30, gravity: 600 }, '変えた項目だけ');
  assert.deepEqual(Object.keys(pk.worldJson.environment).sort(), ['fogFar', 'fogNear', 'skyColor'].sort().filter((k) => k in pk.worldJson.environment));
  assert.equal(pk.worldJson.environment.skyColor, '#112233');
  validateManifest(pk.manifest);
  validateWorld(pk.worldJson, pk.manifest);
  const back = docFromPackage({ manifest: pk.manifest, worldJson: pk.worldJson, report: null });
  assert.deepEqual(back.rules, doc.rules);
  assert.deepEqual(back.environment, doc.environment);
  // 振る舞い
  const r = addPart(doc, { name: 'Lift' });
  doc = setPartBehavior(r.doc, [r.id], 'mover');
  assert.equal(doc.parts[0].attrs.behavior, 'mover');
  doc = setPartBehaviorParam(doc, r.id, 'dy', 20);
  assert.equal(resolveBehavior(doc.parts[0].attrs).params.dy, 20);
  doc = setPartBehaviorParam(doc, 'nope', 'dy', 1); // 存在しないidは何もしない
  doc = setPartBehavior(doc, [r.id], '');
  assert.deepEqual(doc.parts[0].attrs, {});
  const lone = setPartBehaviorParam(doc, r.id, 'dy', 5); // 振る舞いが無いパーツには書かない
  assert.deepEqual(lone.parts[0].attrs, {});
}
assert.throws(() => validateManifest({ formatVersion: '1.0', name: 'x', world: { file: 'world.json' }, rules: [1] }), /rules/);
assert.throws(() => validateWorld({ formatVersion: '1.0', parts: [], environment: 3 }), /environment/);
assert.ok(Object.keys(BEHAVIORS).length === 4);

// ---- 古い下書き(rules / environment が無い版で保存したもの)でも落ちない ----
{
  const old = {
    name: '古い下書き', description: '', players: { max: 8, sendHz: 10 }, logic: null,
    spawns: [{ pos: [0, 1, 0], size: [6, 1, 6] }],
    parts: [{ id: 'p1', name: 'Baseplate', shape: 'block', size: [10, 1, 10], pos: [0, 0, 0], rot: I, color: '#6b8e4e', transparency: 0, collide: true }],
    nextId: 2, source: null, publishedId: null
  };
  const doc = normalizeDoc(old);
  assert.deepEqual(doc.rules, defaultRules());
  assert.deepEqual(doc.environment, defaultEnvironment());
  assert.deepEqual(doc.parts[0].tags, []);
  assert.deepEqual(doc.parts[0].attrs, {});
  assert.equal(old.rules, undefined, '入力は書き換えない');
  assert.equal(doc.nextId, 2);
  const pk = docToPackage(doc);              // 公開・書き出しで落ちない
  assert.equal(pk.manifest.rules, undefined);
  docToPackage(old);                         // 正規化し忘れたdocでも落ちない(多重防御)
  assert.deepEqual(setRules(old, { gravity: 10 }).rules.gravity, 10);
  assert.deepEqual(setEnvironment(old, { ambient: 2 }).environment.ambient, 2);
  assert.doesNotThrow(() => normalizeDoc(null));
  assert.doesNotThrow(() => normalizeDoc({ parts: 'x' }));
}

// ---- エラー表示: 原因を取り違えない ----
{
  const { describeError } = await import('../src/servers/api.js');
  assert.match(describeError(new TypeError('Failed to fetch')), /CORS/);
  const e500 = Object.assign(new Error('internal'), { status: 500, detail: 'D1_ERROR: no such table' });
  assert.match(describeError(e500), /HTTP 500.*internal.*no such table/);
  assert.match(describeError(new Error('パーツがありません')), /^パーツがありません$/, '送る前の失敗は接続エラー扱いにしない');
  assert.match(describeError(Object.assign(new Error('unauthorized'), { status: 401 })), /合言葉/);
  assert.match(describeError(Object.assign(new Error('bad_format'), { status: 400 })), /再デプロイ/);
}

console.log('rules.test: OK');

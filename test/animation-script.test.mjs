import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPlaceAnimations, sanitizeAnimations } from '../src/rbx/place-animations.js';
import { setPlaceAnimations, placeAnimationNames, hasPlaceAnimation, getPlaceAnimation } from '../src/game/anim-registry.js';
import { createAnimate } from '../src/game/animate.js';
import { samplePoses } from '../src/rbx/animation.js';
import { compileBlocklyWorkspace } from '../src/scripting/compiler.js';
import { createBlocklyRuntime } from '../src/scripting/runtime.js';

const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const inst = (className, props = {}, children = []) => { const i = { className, props, children, parent: null }; children.forEach((c) => { c.parent = i; }); return i; };
const pose = (name, x) => inst('Pose', { Name: name, CFrame: { pos: [x, 0, 0], rot: I3 } });
const keyframeSeq = (name, x1) => inst('KeyframeSequence', { Name: name, Loop: false }, [
  inst('Keyframe', { Time: 0 }, [pose('UpperTorso', 0)]), inst('Keyframe', { Time: 1 }, [pose('UpperTorso', x1)])]);
const treeOf = (...roots) => { const all = []; const walk = (i) => { all.push(i); i.children.forEach(walk); }; roots.forEach(walk); return { instances: new Map(all.map((v, k) => [k, v])), roots }; };

test('rbxlのKeyframeSequence/Animationを取り出す(名前の重なりは#2、同じアセットは1つ)', () => {
  const r = extractPlaceAnimations(treeOf(
    keyframeSeq('Wave', 2), keyframeSeq('Wave', 4), inst('KeyframeSequence', { Name: 'Empty' }),
    inst('Animation', { Name: 'Dance', AnimationId: 'rbxassetid://12345' }), inst('Animation', { Name: 'Dance2', AnimationId: 'http://www.roblox.com/asset/?id=12345' }),
    inst('Animation', { Name: 'NoId', AnimationId: '' })));
  assert.deepEqual(r.clips.map((c) => c.name), ['Wave', 'Wave#2']);
  assert.deepEqual(r.refs, [{ name: 'Dance', id: 12345 }]);
  assert.equal(r.skipped.length, 1);
  assert.ok(Math.abs(samplePoses(r.clips[1].anim, 1).UpperTorso.pos[0] - 4) < 1e-9);
});

test('保存データ(.tgw)の検証: JSONを通しても同じ、壊れた項目は捨てる', () => {
  const r = extractPlaceAnimations(treeOf(keyframeSeq('Wave', 2), inst('Animation', { Name: 'Dance', AnimationId: '777' })));
  const back = sanitizeAnimations(JSON.parse(JSON.stringify({ clips: r.clips, refs: r.refs })));
  assert.equal(back.clips.length, 1);
  assert.deepEqual(back.refs, [{ name: 'Dance', id: 777 }]);
  assert.ok(Math.abs(samplePoses(back.clips[0].anim, 1).UpperTorso.pos[0] - 2) < 1e-9);
  const bad = sanitizeAnimations({ clips: [{ name: 'A', anim: { tracks: { X: [{ t: 0, pos: [NaN, 0, 0], q: [0, 0, 0, 1] }] } } }, { name: '', anim: r.clips[0].anim }, null], refs: [{ name: 'R', id: -5 }, { name: 'S', id: 1.5 }] });
  assert.deepEqual(bad, { clips: [], refs: [] });
  assert.deepEqual(sanitizeAnimations(undefined), { clips: [], refs: [] });
});

test('アニメ一覧(レジストリ)は名前で引ける。ワールドを読み込むたびに入れ替わる', async () => {
  const r = extractPlaceAnimations(treeOf(keyframeSeq('Wave', 2), inst('Animation', { Name: 'Dance', AnimationId: '777' })));
  setPlaceAnimations(r);
  assert.deepEqual(placeAnimationNames(), ['Wave', 'Dance']);
  assert.ok(hasPlaceAnimation('Dance') && !hasPlaceAnimation('Nope'));
  assert.equal((await getPlaceAnimation('Wave')).name, 'Wave');
  assert.equal(await getPlaceAnimation('Nope'), null);
  setPlaceAnimations({ clips: [], refs: [] });
  assert.deepEqual(placeAnimationNames(), []);
});

test('アクション(重ね再生): 動かす関節だけを上書きし、終わるとフェードアウトして元に戻る', () => {
  const ctl = createAnimate();
  const base = { length: 1, loop: true, tracks: { UpperTorso: [{ t: 0, pos: [10, 0, 0], q: [0, 0, 0, 1], style: 'Linear', dir: 'In' }], Head: [{ t: 0, pos: [5, 0, 0], q: [0, 0, 0, 1], style: 'Linear', dir: 'In' }] } };
  ctl.setClip('idle', base);
  const act = { length: 0.5, loop: false, tracks: { UpperTorso: [{ t: 0, pos: [0, 0, 0], q: [0, 0, 0, 1], style: 'Linear', dir: 'In' }] } };
  const x = (p, j) => p[j].pos[0];
  assert.equal(x(ctl.update(0.016, 0, true), 'UpperTorso'), 10);
  assert.equal(ctl.playAction('Wave', act, { speed: 1 }), true);
  let p;
  for (let i = 0; i < 20; i++) p = ctl.update(0.016, 0, true); // 約0.32秒: 十分に重なる
  assert.ok(x(p, 'UpperTorso') < 1e-6, '動かす関節は上書きされる');
  assert.equal(x(p, 'Head'), 5, 'ほかの関節は元のまま');
  assert.deepEqual(ctl.actionNames(), ['Wave']);
  for (let i = 0; i < 80; i++) p = ctl.update(0.016, 0, true); // 再生が終わりフェードアウト
  assert.equal(x(p, 'UpperTorso'), 10);
  assert.deepEqual(ctl.actionNames(), []);
  ctl.playAction('Loop', { ...act, loop: true }); ctl.update(0.1, 0, true);
  assert.equal(ctl.stopAction(''), 1);
  for (let i = 0; i < 20; i++) p = ctl.update(0.016, 0, true);
  assert.equal(x(p, 'UpperTorso'), 10);
});

const stmt = (type, fields = {}, next = null) => ({ type, fields, inputs: {}, ...(next ? { next: { block: next } } : {}) });
test('ブロック → IR → Runtime → アダプター: 再生・停止の命令が届く', () => {
  const stop = stmt('rbxl_player_stop_animation', { PLAYER: 'local', ANIM: 'Wave' });
  const play = stmt('rbxl_player_play_animation', { PLAYER: 'local', ANIM: 'Wave', SPEED: 2, LOOP: 'once' }, stop);
  const program = compileBlocklyWorkspace({ blocks: { blocks: [stmt('rbxl_when_start', {}, play)] } });
  assert.deepEqual(program.errors, []);
  assert.deepEqual(program.events[0].body.map((s) => `${s.op}:${s.action}`), ['playerAnimation:play', 'playerAnimation:stop']);
  const calls = [], warnings = [];
  const runtime = createBlocklyRuntime(program, {
    playAnimation: (player, name, opts) => { calls.push(['play', player, name, opts]); return name === 'Wave'; },
    stopAnimation: (player, name) => { calls.push(['stop', player, name]); return true; },
    onWarning: (m) => warnings.push(m),
  });
  runtime.start();
  for (let i = 0; i < 6; i++) runtime.update(0.016);
  assert.deepEqual(calls, [['play', 'local', 'Wave', { speed: 2, loop: false }], ['stop', 'local', 'Wave']]);
  assert.deepEqual(warnings, []);
  // アダプターが無い・名前が無いときは、警告を出して安全に続ける
  const w2 = [];
  const r2 = createBlocklyRuntime(program, { playAnimation: () => false, onWarning: (m) => w2.push(m) });
  r2.start(); for (let i = 0; i < 6; i++) r2.update(0.016);
  assert.ok(w2.length >= 1 && /Wave/.test(w2[0]));
});

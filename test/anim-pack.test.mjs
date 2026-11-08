import assert from 'node:assert/strict';
import { animationSlotsFromReport, animationIdFromUri, animationIdsFromTree } from '../src/rbx/anim-pack.js';
import { createAnimate } from '../src/game/animate.js';

// アバターAPIのアセット一覧から、状態ごとのパックIDを取る(種別名の表記ゆれに強い)
const slots = animationSlotsFromReport([
  { id: 1, type: 'Hat' }, { id: 656118341, type: 'IdleAnimation' }, { id: 656121766, type: 'Walk Animation' },
  { id: 656118852, type: 'runanimation' }, { id: 656117878, type: 'JumpAnimation' }, { id: 656115606, type: 'FallAnimation' },
  { id: 9, type: 'ClimbAnimation' }, { id: 10, type: 'SwimAnimation' }, { id: 11, type: 'WalkAnimation' },
]);
assert.deepEqual(slots, { idle: 656118341, walk: 656121766, run: 656118852, jump: 656117878, fall: 656115606, climb: 9, swim: 10 });
assert.deepEqual(animationSlotsFromReport(undefined), {});

// AnimationId の表記
assert.equal(animationIdFromUri('rbxassetid://656121766'), 656121766);
assert.equal(animationIdFromUri('http://www.roblox.com/asset/?id=656121766'), 656121766);
assert.equal(animationIdFromUri('https://www.roblox.com/asset/?id=5&version=2'), 5);
assert.equal(animationIdFromUri(''), null);
assert.equal(animationIdFromUri(null), null);

// パックの中身: 入れ子の Folder の下の Animation を、Animation1 を先頭に取り出す
const inst = (className, props = {}, children = []) => ({ className, props, children });
const tree = (items) => ({ instances: new Map(items.map((v, k) => [k, v])), roots: [] });
const ids = animationIdsFromTree(tree([
  inst('Folder', { Name: 'R15Anim' }), inst('Folder', { Name: 'idle' }),
  inst('Animation', { Name: 'Animation2', AnimationId: 'rbxassetid://200' }),
  inst('Animation', { Name: 'Animation1', AnimationId: 'http://www.roblox.com/asset/?id=100' }),
  inst('Animation', { Name: 'Broken', AnimationId: '' }),
]));
assert.deepEqual(ids, [100, 200]);

// ラン状態: ランのクリップがあるときだけ、速いときに使う
const clip = (x) => ({ length: 1, loop: true, tracks: { A: [{ t: 0, pos: [x, 0, 0], q: [0, 0, 0, 1], style: 'Linear', dir: 'In' }] } });
const noRun = createAnimate();
noRun.setClip('walk', clip(1)); noRun.update(0.016, 16, true);
assert.equal(noRun.state, 'walk');
const withRun = createAnimate();
withRun.setClip('walk', clip(1)); withRun.setClip('run', clip(2));
withRun.update(0.016, 8, true);
assert.equal(withRun.state, 'walk');
withRun.update(0.016, 16, true);
assert.equal(withRun.state, 'run');

console.log('anim-pack ok');

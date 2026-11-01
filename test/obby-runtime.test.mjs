import assert from 'node:assert/strict';
import { createLogicRuntime, resolveLogicConfig } from '../src/logics/index.js';
import { sphereIntersectsOBB } from '../src/game/collision.js';

// 大きな床の上で足元の球が接するケースもトリガーとして拾う。
const floor = { pos: [0, 0, 0], rot: [1,0,0,0,1,0,0,0,1], half: [60,0.5,40] };
assert.equal(sphereIntersectsOBB([0, 1.4001, 0], 0.9, floor), true);

const calls = [];
const runtime = createLogicRuntime(resolveLogicConfig({ id: 'obby', params: { killY: -20 } }), {
  respawn: () => calls.push(['respawn']),
  setCheckpoint: (position) => calls.push(['checkpoint', position]),
  complete: () => calls.push(['complete'])
});

runtime.update({ position: { y: -21 } });
assert.deepEqual(calls, [['respawn']]);

runtime.onContact({ tag: 'kill', part: {} });
assert.deepEqual(calls.at(-1), ['respawn']);

const checkpoint = {
  pos: [10, 2, 5],
  half: [2, 1, 3],
  rot: [1, 0, 0, 0, 1, 0, 0, 0, 1]
};
runtime.onContact({ tag: 'checkpoint', part: checkpoint });
assert.deepEqual(calls.at(-1), ['checkpoint', [10, 3.2, 5]]);

runtime.onContact({ tag: 'goal', part: {} });
assert.deepEqual(calls.at(-1), ['complete']);
runtime.onContact({ tag: 'kill', part: {} });
assert.deepEqual(calls.at(-1), ['complete']);

runtime.reset();
runtime.onContact({ tag: 'goal', part: {} });
assert.deepEqual(calls.at(-1), ['complete']);

console.log('obby-runtime.test: OK');

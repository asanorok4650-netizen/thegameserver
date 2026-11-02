import test from 'node:test';
import assert from 'node:assert/strict';
import { createProgramIR } from '../src/scripting/ir.js';
import { createBlocklyRuntime } from '../src/scripting/runtime.js';

test('legacy event rules are converted to shared IR and run on the same interpreter', () => {
  const events = [];
  const program = createProgramIR({ eventRules: [
    { id: 'start', enabled: true, event: { type: 'game_start' }, variables: [{ name: 'coins', initial: 2 }], actions: [
      { type: 'change_variable', name: 'coins', expression: { kind: 'number', value: 3 } },
      { type: 'add_score', expression: { kind: 'variable', name: 'coins' } },
      { type: 'show_message', text: 'coins={coins}' }
    ] }
  ] });
  const runtime = createBlocklyRuntime(program, { onScore: (score) => events.push(score), onMessage: (message) => events.push(message) });
  runtime.start();
  for (let i = 0; i < 4; i++) runtime.update(1 / 60);
  assert.equal(runtime.getScore(), 5);
  assert.deepEqual(events, [5, 'coins=5']);
});

test('shared IR preserves touch and leave events and player actions', () => {
  const events = [];
  const program = createProgramIR({ eventRules: [
    { id: 'touch', event: { type: 'touch', target: 'p1' }, actions: [{ type: 'show_message', text: 'enter' }] },
    { id: 'leave', event: { type: 'leave', target: 'p1' }, actions: [{ type: 'respawn' }] }
  ] });
  const runtime = createBlocklyRuntime(program, { onMessage: (v) => events.push(v), respawn: () => events.push('respawn') });
  runtime.onTouch({ id: 'p1', name: 'Door' });
  runtime.onLeave({ id: 'p1', name: 'Door' });
  for (let i = 0; i < 3; i++) runtime.update(1 / 60);
  assert.deepEqual(events, ['enter', 'respawn']);
});

test('shared IR initializes variables once and invokes part action adapters', () => {
  const calls = [];
  const program = { version: 1, variables: [{ name: 'coins', initial: 4 }], events: [{ event: 'start', body: [
    { op: 'setVariable', name: 'coins', value: { op: 'number', value: 7 } },
    { op: 'partVisible', part: 'Door', visible: false },
    { op: 'movePart', part: 'Door', position: [1, 2, 3] }
  ] }] };
  const runtime = createBlocklyRuntime(program, {
    setPartVisible: (...args) => calls.push(['visible', ...args]),
    movePart: (...args) => calls.push(['move', ...args])
  });
  runtime.start();
  for (let i = 0; i < 4; i++) runtime.update(1 / 60);
  assert.equal(runtime.getVariables().coins, 7);
  assert.deepEqual(calls, [['visible', 'Door', false], ['move', 'Door', [1, 2, 3]]]);
});

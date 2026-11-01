import test from 'node:test';
import assert from 'node:assert/strict';
import { compileBlocklyWorkspace } from '../src/scripting/compiler.js';
import { createBlocklyRuntime } from '../src/scripting/runtime.js';

const value = (type, fields = {}) => ({ type, fields, inputs: {} });
const statement = (type, fields = {}, inputs = {}, next = null) => ({ type, fields, inputs, ...(next ? { next: { block: next } } : {}) });

test('compiler converts event, score action and nested comparison into data IR', () => {
  const workspace = { blocks: { blocks: [
    statement('rbxl_when_start', {}, {}, statement('rbxl_if', {}, {
      CONDITION: { block: statement('rbxl_compare', { OP: 'GTE' }, {
        A: { block: value('rbxl_number', { VALUE: 3 }) },
        B: { block: value('rbxl_number', { VALUE: 2 }) }
      }) },
      DO: { block: statement('rbxl_add_score', {}, { VALUE: { block: value('rbxl_number', { VALUE: 5 }) } }) }
    }))
  ] } };
  const result = compileBlocklyWorkspace(workspace);
  assert.deepEqual(result.errors, []);
  assert.equal(result.events[0].event, 'start');
  assert.equal(result.events[0].body[0].op, 'if');
  assert.equal(result.events[0].body[0].then[0].op, 'addScore');
});

test('runtime executes start event, conditions, repeat and score updates', () => {
  const scores = [];
  const runtime = createBlocklyRuntime({ version: 1, events: [{
    event: 'start', body: [
      { op: 'repeat', times: 3, body: [{ op: 'addScore', amount: { op: 'number', value: 2 } }] }
    ]
  }] }, { onScore: (score) => scores.push(score) });
  runtime.start();
  for (let i = 0; i < 20; i++) runtime.update(1 / 60);
  assert.equal(runtime.getScore(), 6);
  assert.deepEqual(scores, [2, 4, 6]);
});

test('runtime supports touch and interval events and bounds repeated work', () => {
  let messages = 0;
  const runtime = createBlocklyRuntime({ version: 1, events: [
    { event: 'touch', target: 'p1', body: [{ op: 'message', text: 'touch' }] },
    { event: 'interval', seconds: 0.1, body: [{ op: 'message', text: 'timer' }] }
  ] }, { onMessage: () => messages++ });
  runtime.onTouch({ id: 'p1' });
  for (let i = 0; i < 10; i++) runtime.update(0.05);
  assert.ok(messages >= 2);
});

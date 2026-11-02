import test from 'node:test';
import assert from 'node:assert/strict';
import { compileBlocklyWorkspace } from '../src/scripting/compiler.js';
import { createScriptingRuntime } from '../src/scripting/runtime.js';

const value = (type, fields = {}) => ({ type, fields, inputs: {} });
const statement = (type, fields = {}, inputs = {}, next = null) => ({ type, fields, inputs, ...(next ? { next: { block: next } } : {}) });

test('M1-E compiler emits event context expression IR', () => {
  const first = statement('rbxl_set_variable', { NAME: 'player' }, { VALUE: { block: value('rbxl_event_player_id') } });
  first.next = { block: statement('rbxl_set_variable', { NAME: 'partId' }, { VALUE: { block: value('rbxl_event_part_id') } }) };
  const workspace = { blocks: { blocks: [statement('rbxl_when_touch', { PART: 'Door' }, {}, first)] } };
  const result = compileBlocklyWorkspace(workspace);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.events[0].body.map((step) => step.value.op), ['eventGet', 'eventGet']);
  assert.deepEqual(result.events[0].body.map((step) => step.value.property), ['playerId', 'partId']);
});

test('M1-E event context stays scoped to each asynchronous event task', () => {
  const variables = [];
  const runtime = createScriptingRuntime({ version: 1, events: [
    { event: 'touch', target: 'door', body: [
      { op: 'wait', seconds: { op: 'number', value: 0.05 } },
      { op: 'setVariable', name: 'touchPlayer', value: { op: 'eventGet', property: 'playerId' } },
      { op: 'setVariable', name: 'touchPart', value: { op: 'eventGet', property: 'partName' } },
      { op: 'setVariable', name: 'touchType', value: { op: 'eventGet', property: 'eventType' } }
    ] }
  ] });
  runtime.onTouch({ id: 'door', name: 'Door' }, 'local');
  runtime.onTouch({ id: 'door', name: 'Door' }, 'player-2');
  for (let i = 0; i < 10; i++) runtime.update(0.02);
  Object.assign(variables, runtime.getVariables());
  assert.equal(variables.touchPlayer, 'player-2');
  assert.equal(variables.touchPart, 'Door');
  assert.equal(variables.touchType, 'touch');
});

test('M1-E event context is empty for fields not supplied by the event', () => {
  const runtime = createScriptingRuntime({ version: 1, events: [
    { event: 'start', body: [{ op: 'setVariable', name: 'part', value: { op: 'eventGet', property: 'partId' } }] }
  ] });
  runtime.start();
  runtime.update(0.016);
  assert.equal(runtime.getVariables().part, '');
});

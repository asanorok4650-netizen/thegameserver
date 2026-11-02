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
  const runtime = createScriptingRuntime({ version: 1, events: [
    { event: 'touch', target: 'door', body: [
      { op: 'wait', seconds: { op: 'number', value: 0.05 } },
      { op: 'setVariable', name: 'touchPlayer', value: { op: 'eventGet', property: 'playerId' } },
      { op: 'setVariable', name: 'touchPart', value: { op: 'eventGet', property: 'partName' } }
    ] },
    { event: 'leave', target: 'door', body: [
      { op: 'wait', seconds: { op: 'number', value: 0.05 } },
      { op: 'setVariable', name: 'leavePlayer', value: { op: 'eventGet', property: 'playerId' } },
      { op: 'setVariable', name: 'leavePart', value: { op: 'eventGet', property: 'partName' } },
      { op: 'setVariable', name: 'leaveType', value: { op: 'eventGet', property: 'eventType' } }
    ] }
  ] });
  runtime.onTouch({ id: 'door', name: 'Door' }, 'local');
  runtime.onLeave({ id: 'door', name: 'Door' }, 'player-2');
  for (let i = 0; i < 10; i++) runtime.update(0.02);
  const variables = runtime.getVariables();
  assert.equal(variables.touchPlayer, 'local');
  assert.equal(variables.touchPart, 'Door');
  assert.equal(variables.leavePlayer, 'player-2');
  assert.equal(variables.leavePart, 'Door');
  assert.equal(variables.leaveType, 'leave');
});

test('M1-E event context is empty for fields not supplied by the event', () => {
  const runtime = createScriptingRuntime({ version: 1, events: [
    { event: 'start', body: [{ op: 'setVariable', name: 'part', value: { op: 'eventGet', property: 'partId' } }] }
  ] });
  runtime.start();
  runtime.update(0.016);
  assert.equal(runtime.getVariables().part, '');
});

test('M1-E compiler emits per-event elapsed time IR and types it as a number', () => {
  const add = statement('rbxl_add_score', {}, { VALUE: { block: value('rbxl_event_elapsed_time') } });
  const result = compileBlocklyWorkspace({ blocks: { blocks: [statement('rbxl_when_start', {}, {}, add)] } });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.events[0].body[0].amount, { op: 'eventElapsed' });
});

test('M1-E event elapsed time is measured from each task start and not shared between tasks', () => {
  const runtime = createScriptingRuntime({ version: 1, events: [
    { event: 'touch', target: 'door', body: [
      { op: 'wait', seconds: { op: 'number', value: 0.1 } },
      { op: 'setVariable', name: 'touchElapsed', value: { op: 'eventElapsed' } },
      { op: 'setVariable', name: 'sinceGame', value: { op: 'elapsed' } }
    ] }
  ] });
  for (let i = 0; i < 10; i++) runtime.update(0.05); // ゲーム開始から約0.5秒進めてからイベントを起こす
  runtime.onTouch({ id: 'door', name: 'Door' }, 'local');
  for (let i = 0; i < 10; i++) runtime.update(0.05);
  const variables = runtime.getVariables();
  assert.ok(variables.touchElapsed >= 0.1 && variables.touchElapsed < 0.25, 'イベント開始からの経過: ' + variables.touchElapsed);
  assert.ok(variables.sinceGame > variables.touchElapsed + 0.4, 'ゲーム開始からの経過はイベント経過より大きい');
});

test('M1-E event elapsed time is 0 outside an event task context', () => {
  const runtime = createScriptingRuntime({ version: 1, events: [
    { event: 'start', body: [{ op: 'setVariable', name: 't', value: { op: 'eventElapsed' } }] }
  ] });
  runtime.start();
  runtime.update(0.016);
  assert.ok(runtime.getVariables().t < 0.1);
});

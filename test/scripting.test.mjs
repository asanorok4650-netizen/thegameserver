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

// ---- 回帰テスト: 見つかった不具合 ----
const run = (workspace, frames = 120) => {
  const log = [];
  const program = compileBlocklyWorkspace(workspace);
  const runtime = createBlocklyRuntime(program, { onMessage: (m) => log.push(m), onScore: (s) => log.push('score=' + s) });
  runtime.start();
  for (let i = 0; i < frames; i++) runtime.update(1 / 60);
  return { program, log, runtime };
};
const start = (first) => ({ blocks: { blocks: [statement('rbxl_when_start', {}, {}, first)] } });
const msg = (text) => statement('rbxl_show_message', { TEXT: text });
const bool = (b) => ({ block: value('logic_boolean', { BOOL: b ? 'TRUE' : 'FALSE' }) });

test('rbxl_repeat のフィールドの回数どおりに繰り返す', () => {
  const r = run(start(statement('rbxl_repeat', { TIMES: 3 }, { DO: { block: msg('hi') } })));
  assert.deepEqual(r.log, ['hi', 'hi', 'hi']);
  assert.deepEqual(r.program.errors, []);
});

test('標準の controls_if: IF0/DO0・でなければもし(IF1/DO1)・ELSE', () => {
  const mk = (c0, c1) => start({ type: 'controls_if', extraState: { elseIfCount: 1, hasElse: true }, inputs: {
    IF0: bool(c0), DO0: { block: msg('A') }, IF1: bool(c1), DO1: { block: msg('B') }, ELSE: { block: msg('C') }
  } });
  assert.deepEqual(run(mk(true, true)).log, ['A']);
  assert.deepEqual(run(mk(false, true)).log, ['B']);
  assert.deepEqual(run(mk(false, false)).log, ['C']);
  // elseなし・条件がfalseなら何も起きない
  assert.deepEqual(run(start({ type: 'controls_if', inputs: { IF0: bool(false), DO0: { block: msg('A') } } })).log, []);
  assert.deepEqual(run(start({ type: 'controls_if', inputs: { IF0: bool(true), DO0: { block: msg('A') } } })).log, ['A']);
});

test('rbxl_if は従来どおり動く', () => {
  assert.deepEqual(run(start(statement('rbxl_if', {}, { CONDITION: bool(true), DO: { block: msg('then') } }))).log, ['then']);
});

test('空の入れ子の繰り返しでも1フレームが固まらない(作業量の上限)', () => {
  const times = (n) => ({ block: value('math_number', { VALUE: n }) });
  const loop = (inner) => ({ type: 'controls_repeat_ext', inputs: { TIMES: times(100), ...(inner ? { DO: { block: inner } } : {}) } });
  const nested = start(loop(loop(loop(loop(loop(null))))));
  const program = compileBlocklyWorkspace(nested);
  const runtime = createBlocklyRuntime(program, {});
  runtime.start();
  const t0 = Date.now();
  for (let i = 0; i < 60; i++) runtime.update(1 / 60);
  assert.ok(Date.now() - t0 < 1500, '60フレーム分の処理が1.5秒以内に終わる');
});

test('繰り返しは作業量の上限を超えても、後のフレームで続きを実行する', () => {
  const r = run(start(statement('rbxl_repeat', { TIMES: 50 }, { DO: { block: statement('rbxl_add_score', {}, { VALUE: { block: value('rbxl_number', { VALUE: 1 }) } }) } })), 400);
  assert.equal(r.runtime.getScore(), 50);
});

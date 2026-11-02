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

test('unsupported statement and value blocks produce explicit compiler errors', () => {
  const unsupportedStatement = start(statement('controls_whileUntil', {}, {
    BOOL: bool(true),
    DO: { block: msg('not executed') }
  }));
  const statementResult = compileBlocklyWorkspace(unsupportedStatement);
  assert.ok(statementResult.errors.some((error) => error.includes('未対応の処理ブロック: controls_whileUntil')));

  const unsupportedValue = start(statement('rbxl_add_score', {}, {
    VALUE: { block: value('text', { TEXT: 'not a number' }) }
  }));
  const valueResult = compileBlocklyWorkspace(unsupportedValue);
  assert.ok(valueResult.errors.some((error) => error.includes('未対応の値ブロック: text')));
});

test('toolbox standard math and variable blocks compile and execute', () => {
  const math = statement('rbxl_add_score', {}, {
    VALUE: { block: statement('math_modulo', {}, {
      DIVIDEND: { block: value('math_number', { NUM: 9 }) },
      DIVISOR: { block: value('math_number', { NUM: 4 }) }
    }) }
  });
  const abs = statement('rbxl_add_score', {}, {
    VALUE: { block: statement('math_single', { OP: 'ABS' }, {
      NUM: { block: value('math_number', { NUM: -5 }) }
    }) }
  });
  const workspace = {
    variables: [{ id: 'coins-id', name: 'coins' }],
    blocks: { blocks: [start(statement('variables_set', { VAR: { id: 'coins-id', name: 'coins' } }, {
      VALUE: { block: value('math_number', { NUM: 3 }) }
    }, statement('rbxl_add_score', {}, {
      VALUE: { block: value('variables_get', { VAR: { id: 'coins-id', name: 'coins' } }) }
    }))).blocks.blocks[0]] }
  };
  workspace.blocks.blocks[0].next.block.next = { block: math };
  math.next = { block: abs };

  const result = run(workspace);
  assert.deepEqual(result.program.errors, []);
  assert.equal(result.runtime.getVariables().coins, 3);
  assert.equal(result.runtime.getScore(), 9);
});



test('compiler validates input types and supplies typed defaults for empty sockets', () => {
  const wrongType = start(statement('rbxl_if', {}, {
    CONDITION: { block: value('math_number', { NUM: 1 }) },
    DO: { block: msg('should not run') }
  }));
  const invalid = compileBlocklyWorkspace(wrongType);
  assert.ok(invalid.errors.some((error) => error.includes('入力型エラー: rbxl_if.CONDITION')));
  assert.equal(invalid.events[0].body[0].condition.op, 'number');

  const emptyCondition = start(statement('rbxl_if', {}, { DO: { block: msg('not run') } }));
  const defaults = compileBlocklyWorkspace(emptyCondition);
  assert.deepEqual(defaults.errors, []);
  assert.deepEqual(defaults.events[0].body[0].condition, { op: 'boolean', value: false });
});

test('compiler reports unknown top-level and variable statement blocks', () => {
  const unknownRoot = { blocks: { blocks: [statement('controls_whileUntil')] } };
  assert.ok(compileBlocklyWorkspace(unknownRoot).errors.some((error) => error.includes('未対応のトップレベルブロック: controls_whileUntil')));

  const unknownStatement = start(statement('variables_change', { VAR: { id: 'coins-id', name: 'coins' } }));
  assert.ok(compileBlocklyWorkspace(unknownStatement).errors.some((error) => error.includes('未対応の処理ブロック: variables_change')));
});

test('compiler clamps invalid numeric fields and reports malformed numeric values', () => {
  const workspace = start(statement('rbxl_move_part', { X: 'NaN', Y: 1e20, Z: -1e20 }));
  const result = compileBlocklyWorkspace(workspace);
  assert.ok(result.errors.some((error) => error.includes('数値フィールドが不正です: rbxl_move_part.X')));
  assert.deepEqual(result.events[0].body[0].position, [0, 1e9, -1e9]);
});


test('compiler reports invalid unary math operators', () => {
  const workspace = start(statement('rbxl_add_score', {}, {
    VALUE: { block: statement('math_single', { OP: 'EXECUTE' }, { NUM: { block: value('math_number', { NUM: 2 }) } }) }
  }));
  assert.ok(compileBlocklyWorkspace(workspace).errors.some((error) => error.includes('未対応の単項演算子: EXECUTE')));
});

test('runtime warns once for unknown instructions and sanitizes non-finite numbers', () => {
  const warnings = [];
  const runtime = createBlocklyRuntime({ version: 1, events: [{ event: 'start', body: [
    { op: 'futureInstruction' },
    { op: 'addScore', amount: { op: 'number', value: Infinity } },
    { op: 'futureInstruction' }
  ] }] }, { onWarning: (warning) => warnings.push(warning) });
  runtime.start();
  for (let i = 0; i < 4; i++) runtime.update(1 / 60);
  assert.equal(runtime.getScore(), 0);
  assert.equal(warnings.filter((warning) => warning.includes('futureInstruction')).length, 1);
});


test('all toolbox value block families compile without errors', () => {
  const number = (n) => ({ block: value('math_number', { NUM: n }) });
  const score = (expression) => statement('rbxl_add_score', {}, { VALUE: { block: expression } });
  const expressions = [
    statement('rbxl_number', { VALUE: 2 }),
    statement('math_arithmetic', { OP: 'MULTIPLY' }, { A: number(3), B: number(4) }),
    statement('logic_compare', { OP: 'GTE' }, { A: number(4), B: number(2) }),
    statement('logic_operation', { OP: 'AND' }, {
      A: { block: value('logic_boolean', { BOOL: 'TRUE' }) },
      B: { block: statement('logic_negate', {}, { BOOL: { block: value('logic_boolean', { BOOL: 'FALSE' }) } }) }
    }),
    statement('rbxl_compare', { OP: 'NEQ' }, { A: number(1), B: number(2) })
  ];
  let first = score(expressions[0]);
  let tail = first;
  for (const expression of expressions.slice(1)) {
    const next = score(expression);
    tail.next = { block: next };
    tail = next;
  }
  const result = compileBlocklyWorkspace(start(first));
  assert.deepEqual(result.errors, []);
  assert.equal(result.events[0].body.length, expressions.length);
});

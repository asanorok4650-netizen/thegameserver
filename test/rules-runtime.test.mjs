import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuleRuntime } from '../src/rules/runtime.js';
import { validateEventRules } from '../src/rules/schema.js';

test('touch rule checks score condition and runs actions in order', () => {
  const events = [];
  const runtime = createRuleRuntime([{ id:'a', enabled:true, event:{type:'touch',target:'p1'}, conditions:[{type:'score_compare',op:'gte',value:0}], actions:[{type:'add_score',value:5},{type:'show_message',text:'ok'}]}], { onScore:(v)=>events.push(v), onMessage:(v)=>events.push(v) });
  runtime.onTouch({id:'p1'});
  assert.deepEqual(events,[5,'ok']);
  assert.equal(runtime.getScore(),5);
});

test('interval rule fires after configured duration', () => {
  let count=0;
  const runtime=createRuleRuntime([{id:'timer',event:{type:'interval',seconds:1},actions:[{type:'add_score',value:1}]}],{onScore:()=>count++});
  for (let i = 0; i < 20; i++) runtime.update(.05);
  assert.equal(count,1);
});

test('logic expressions support AND, OR and NOT with arithmetic', () => {
  const events = [];
  const runtime = createRuleRuntime([{
    id: 'logic', event: { type: 'game_start' },
    conditionTree: { kind: 'logic', op: 'and', items: [
      { kind: 'compare', op: 'gte', left: { kind: 'math', op: 'mul', left: { kind: 'number', value: 3 }, right: { kind: 'number', value: 4 } }, right: { kind: 'number', value: 12 } },
      { kind: 'logic', op: 'not', items: [{ kind: 'compare', op: 'eq', left: { kind: 'number', value: 1 }, right: { kind: 'number', value: 2 } }] }
    ] },
    actions: [{ type: 'show_message', text: 'logic-ok' }]
  }], { onMessage: (v) => events.push(v) });
  runtime.start();
  assert.deepEqual(events, ['logic-ok']);
});

test('variables can be initialized, changed, and used in expressions', () => {
  const scores = [];
  const runtime = createRuleRuntime([{
    id: 'vars', variables: [{ name: 'coins', initial: 2 }],
    event: { type: 'game_start' }, actions: [
      { type: 'change_variable', name: 'coins', expression: { kind: 'math', op: 'add', left: { kind: 'variable', name: 'coins' }, right: { kind: 'number', value: 5 } } },
      { type: 'add_score', expression: { kind: 'variable', name: 'coins' } }
    ]
  }], { onScore: (v) => scores.push(v) });
  runtime.start();
  assert.equal(runtime.getVariable('coins'), 7);
  assert.equal(runtime.getScore(), 7);
  assert.deepEqual(scores, [7]);
});

test('IF/ELSE and REPEAT execute nested blocks in order', () => {
  const messages = [];
  const runtime = createRuleRuntime([{
    id: 'control', event: { type: 'game_start' }, variables: [{ name: 'coins', initial: 0 }],
    steps: [
      { type: 'repeat', count: 3, body: [
        { type: 'change_variable', name: 'coins', expression: { kind: 'number', value: 2 } },
        { type: 'if', condition: { kind: 'compare', op: 'gte', left: { kind: 'variable', name: 'coins' }, right: { kind: 'number', value: 4 } },
          then: [{ type: 'add_score', expression: { kind: 'variable', name: 'coins' } }],
          else: [{ type: 'show_message', text: 'まだ' }] }
      ] },
      { type: 'show_message', text: 'coins={coins}, gems={gems}' }
    ]
  }], { onMessage: (message) => messages.push(message) });
  runtime.start();
  assert.equal(runtime.getVariable('coins'), 6);
  assert.equal(runtime.getScore(), 10);
  assert.deepEqual(messages, ['まだ', 'coins=6']);
});

test('save validation rejects undeclared, duplicate, and malformed variable names', () => {
  const errors = validateEventRules([{
    event: { type: 'game_start' }, actions: [{ type: 'show_message', text: 'coins={coins}' }],
    variables: [{ name: 'bad name', initial: 0 }, { name: 'coins', initial: 0 }, { name: 'coins', initial: 1 }]
  }]);
  assert.ok(errors.some((error) => error.includes('変数名')));
  assert.ok(errors.some((error) => error.includes('重複')));
  assert.ok(errors.some((error) => error.includes('宣言されていません')));
});

test('repeat execution has a bounded instruction budget', () => {
  const warnings = [];
  const runtime = createRuleRuntime([{
    id: 'budget', event: { type: 'game_start' },
    steps: [{ type: 'repeat', count: 50, body: [{ type: 'repeat', count: 50, body: [{ type: 'add_score', value: 1 }] }] }]
  }], { onWarning: (warning) => warnings.push(warning) });
  runtime.start();
  assert.ok(runtime.getScore() < 2500);
  assert.ok(warnings.length > 0);
});

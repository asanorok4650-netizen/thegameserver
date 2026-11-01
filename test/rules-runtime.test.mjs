import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuleRuntime } from '../src/rules/runtime.js';
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

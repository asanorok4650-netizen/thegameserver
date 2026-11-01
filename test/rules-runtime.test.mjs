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

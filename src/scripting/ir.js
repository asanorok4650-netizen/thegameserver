// 旧eventRulesとBlocklyワークスペースを共通のデータ専用IRへ正規化する。
import { compileBlocklyWorkspace } from './compiler.js';
import { normalizeEventRules } from '../rules/schema.js';

const clamp = (n, min, max) => Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
const num = (v) => ({ op: 'number', value: clamp(Number(v), -1e9, 1e9) });
const expr = (node) => {
  if (!node || typeof node !== 'object') return num(0);
  if (node.kind === 'number') return num(node.value);
  if (node.kind === 'variable') return { op: 'variable', name: String(node.name || 'score') };
  if (node.kind === 'math') return { op: 'math', operator: node.op, a: expr(node.left), b: expr(node.right) };
  if (node.kind === 'compare') return { op: 'compare', operator: node.op, a: expr(node.left), b: expr(node.right) };
  if (node.kind === 'logic') {
    if (node.op === 'not') return { op: 'not', value: expr(node.items?.[0]) };
    return { op: node.op === 'or' ? 'or' : 'and', a: expr(node.items?.[0]), b: expr(node.items?.[1]) };
  }
  return num(0);
};
function oldAction(action) {
  switch (action.type) {
    case 'add_score': return { op: 'addScore', amount: action.expression ? expr(action.expression) : num(action.value) };
    case 'set_variable': return { op: 'setVariable', name: action.name, value: expr(action.expression) };
    case 'change_variable': return { op: 'changeVariable', name: action.name, value: expr(action.expression) };
    case 'show_message': return { op: 'message', text: action.text };
    case 'teleport': return { op: 'teleportToPart', part: action.target };
    case 'set_checkpoint': return { op: 'checkpointAtPart', part: action.target };
    case 'respawn': return { op: 'respawn' };
    case 'complete': return { op: 'complete' };
    default: return null;
  }
}
function oldSteps(steps) {
  return (steps || []).map((step) => {
    if (step.type === 'if') return { op: 'if', condition: expr(step.condition), then: oldSteps(step.then), otherwise: oldSteps(step.else) };
    if (step.type === 'repeat') return { op: 'repeat', times: num(step.count), body: oldSteps(step.body) };
    return oldAction(step);
  }).filter(Boolean);
}
export function eventRulesToIR(rawRules) {
  const rules = normalizeEventRules(rawRules);
  const events = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const event = ({ game_start: 'start', touch: 'touch', leave: 'leave', interval: 'interval' })[rule.event.type];
    if (!event) continue;
    let body = oldSteps(Array.isArray(rule.steps) ? rule.steps : rule.actions);
    if (rule.conditionTree) body = [{ op: 'if', condition: expr(rule.conditionTree), then: body, otherwise: [] }];
    for (const condition of rule.conditions || []) {
      body = [{ op: 'if', condition: { op: 'compare', operator: condition.op, a: { op: 'variable', name: 'score' }, b: num(condition.value) }, then: body, otherwise: [] }];
    }
    events.push({ event, target: rule.event.target || '', seconds: rule.event.seconds || 5, variables: (rule.variables || []).map((v) => ({ name: v.name, initial: v.initial })), body });
  }
  return { version: 1, events };
}
export function createProgramIR({ workspace, eventRules } = {}) {
  const blockProgram = compileBlocklyWorkspace(workspace);
  const legacyProgram = eventRulesToIR(eventRules);
  const events = [...legacyProgram.events, ...blockProgram.events];
  const variables = new Map();
  for (const event of events) for (const v of event.variables || []) if (!variables.has(v.name)) variables.set(v.name, v.initial);
  return { version: 1, events: events.map(({ variables: _variables, ...event }) => event), variables: [...variables].map(([name, initial]) => ({ name, initial })), errors: blockProgram.errors || [] };
}

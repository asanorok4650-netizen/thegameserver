import { normalizeEventRules, RULE_LIMITS } from './schema.js';

/** Deterministic, data-only rule runner. Expressions are bounded ASTs; JSON is never executed as code. */
export function createRuleRuntime(rawRules, api = {}) {
  const rules = normalizeEventRules(rawRules);
  const timers = new Map();
  const variables = new Map();
  let score = 0;
  let stopped = false;
  const parts = new Map((api.parts || []).map((p) => [p.id, p]));
  for (const rule of rules) for (const variable of rule.variables || []) {
    if (!variables.has(variable.name)) variables.set(variable.name, variable.initial);
  }
  variables.set('score', 0);

  const evaluate = (node) => {
    if (!node || typeof node !== 'object') return 0;
    if (node.kind === 'number') return node.value;
    if (node.kind === 'variable') return variables.get(node.name) ?? 0;
    if (node.kind === 'math') {
      const a = Number(evaluate(node.left)) || 0, b = Number(evaluate(node.right)) || 0;
      let result;
      switch (node.op) {
        case 'sub': result = a - b; break;
        case 'mul': result = a * b; break;
        case 'div': result = b === 0 ? 0 : a / b; break;
        case 'mod': result = b === 0 ? 0 : a % b; break;
        default: result = a + b;
      }
      return Number.isFinite(result) ? Math.max(-1000000000, Math.min(1000000000, result)) : 0;
    }
    if (node.kind === 'compare') {
      const a = evaluate(node.left), b = evaluate(node.right);
      switch (node.op) {
        case 'lte': return a <= b; case 'eq': return a === b; case 'neq': return a !== b;
        case 'gt': return a > b; case 'lt': return a < b; default: return a >= b;
      }
    }
    if (node.kind === 'logic') {
      const items = node.items || [];
      if (node.op === 'not') return !Boolean(items.length ? evaluate(items[0]) : false);
      if (node.op === 'or') return items.some((x) => Boolean(evaluate(x)));
      return items.every((x) => Boolean(evaluate(x)));
    }
    return 0;
  };

  const conditionsPass = (rule) => {
    if (rule.conditionTree && !Boolean(evaluate(rule.conditionTree))) return false;
    return (rule.conditions || []).every((c) => c.type !== 'score_compare' ||
      (c.op === 'lte' ? score <= c.value : c.op === 'eq' ? score === c.value : score >= c.value));
  };

  const executeAction = (action, rule) => {
    switch (action.type) {
      case 'add_score': {
        const amount = action.expression ? Number(evaluate(action.expression)) || 0 : action.value;
        score += amount; variables.set('score', score); api.onScore?.(score, amount); break;
      }
      case 'set_variable': variables.set(action.name, Number(evaluate(action.expression)) || 0); break;
      case 'change_variable': variables.set(action.name, (variables.get(action.name) || 0) + (Number(evaluate(action.expression)) || 0)); break;
      case 'show_message': api.onMessage?.(action.text.replace(/\{([a-zA-Z0-9_ぁ-んァ-ヶ一-龠]+)\}/g, (_, name) => String(variables.get(name) ?? 0))); break;
      case 'teleport':
      case 'set_checkpoint': {
        const target = parts.get(action.target);
        if (!target) { api.onWarning?.('ルール「' + rule.id + '」: 対象パーツ ' + action.target + ' が見つかりません'); break; }
        const position = [target.pos[0], target.pos[1] + target.size[1] / 2 + 0.2, target.pos[2]];
        if (action.type === 'teleport') api.teleport?.(position); else api.setCheckpoint?.(position);
        break;
      }
      case 'respawn': api.respawn?.(); break;
      case 'complete': stopped = true; api.complete?.(); break;
    }
  };

  const executeSteps = (steps, rule, budget, depth = 0) => {
    if (depth > RULE_LIMITS.maxStepDepth || stopped) return;
    for (const step of steps || []) {
      if (stopped || budget.remaining <= 0) break;
      budget.remaining--;
      if (step.type === 'if') {
        executeSteps(Boolean(evaluate(step.condition)) ? step.then : step.else, rule, budget, depth + 1);
      } else if (step.type === 'repeat') {
        const count = Math.min(RULE_LIMITS.maxRepeat, Math.max(0, Math.floor(step.count || 0)));
        for (let i = 0; i < count && !stopped && budget.remaining > 0; i++) {
          executeSteps(step.body, rule, budget, depth + 1);
        }
      } else executeAction(step, rule);
    }
  };

  const runActions = (rule) => {
    if (stopped || !conditionsPass(rule)) return;
    const budget = { remaining: 500 };
    executeSteps(Array.isArray(rule.steps) ? rule.steps : rule.actions, rule, budget);
    if (budget.remaining <= 0) api.onWarning?.('ルール「' + rule.id + '」: 1回の実行で処理できるブロック数の上限に達しました');
  };
  const matching = (type, target) => rules.filter((r) => r.enabled && r.event.type === type && (!r.event.target || r.event.target === target));
  return {
    start() { for (const rule of matching('game_start')) runActions(rule); },
    onTouch(part) { for (const rule of matching('touch', part.id)) runActions(rule); },
    onLeave(part) { for (const rule of matching('leave', part.id)) runActions(rule); },
    update(dt) {
      if (stopped) return;
      const step = Math.min(0.05, Math.max(0, dt || 0));
      for (const rule of rules) {
        if (!rule.enabled || rule.event.type !== 'interval') continue;
        const period = rule.event.seconds || 5, next = (timers.get(rule.id) || 0) + step;
        if (next >= period) { timers.set(rule.id, next % period); runActions(rule); } else timers.set(rule.id, next);
      }
    },
    getScore: () => score,
    getVariable: (name) => variables.get(name) ?? 0,
    getVariables: () => Object.fromEntries(variables),
    usesContactEvents: rules.some((r) => r.enabled && ['touch', 'leave'].includes(r.event.type)),
    watchedPartIds: () => { const contactRules = rules.filter((r) => r.enabled && ['touch', 'leave'].includes(r.event.type)); if (contactRules.some((r) => !r.event.target)) return null; return new Set(contactRules.map((r) => r.event.target)); },
    reset() { timers.clear(); score = 0; stopped = false; variables.clear(); for (const rule of rules) for (const variable of rule.variables || []) if (!variables.has(variable.name)) variables.set(variable.name, variable.initial); variables.set('score', 0); api.onScore?.(0, 0); }
  };
}

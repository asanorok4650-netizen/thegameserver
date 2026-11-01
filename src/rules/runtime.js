import { normalizeEventRules } from './schema.js';
/** Small deterministic rule runner. It executes only registered actions; JSON never contains code. */
export function createRuleRuntime(rawRules, api = {}) {
  const rules = normalizeEventRules(rawRules);
  const timers = new Map();
  const firedOnce = new Set();
  let elapsed = 0;
  let score = 0;
  let stopped = false;
  const parts = new Map((api.parts || []).map((p) => [p.id, p]));
  const conditionsPass = (conditions) => conditions.every((c) => c.type !== 'score_compare' ||
    (c.op === 'lte' ? score <= c.value : c.op === 'eq' ? score === c.value : score >= c.value));
  const runActions = (rule, context) => {
    if (stopped || !conditionsPass(rule.conditions)) return;
    for (const action of rule.actions) {
      switch (action.type) {
        case 'add_score':
          score += action.value;
          api.onScore?.(score, action.value);
          break;
        case 'show_message':
          api.onMessage?.(action.text);
          break;
        case 'teleport':
        case 'set_checkpoint': {
          const target = parts.get(action.target);
          if (!target) { api.onWarning?.(`ルール「${rule.id}」: 対象パーツ ${action.target} が見つかりません`); break; }
          const position = [target.pos[0], target.pos[1] + target.size[1] / 2 + 0.2, target.pos[2]];
          if (action.type === 'teleport') api.teleport?.(position);
          else api.setCheckpoint?.(position);
          break;
        }
        case 'respawn': api.respawn?.(); break;
        case 'complete': stopped = true; api.complete?.(); break;
      }
      if (stopped) break;
    }
  };
  const matching = (type, target) => rules.filter((r) => r.enabled && r.event.type === type &&
    (!r.event.target || r.event.target === target));
  return {
    start() {
      for (const rule of matching('game_start')) runActions(rule, {});
    },
    onTouch(part) {
      for (const rule of matching('touch', part.id)) runActions(rule, { part });
    },
    onLeave(part) {
      for (const rule of matching('leave', part.id)) runActions(rule, { part });
    },
    update(dt) {
      if (stopped) return;
      elapsed += Math.min(0.05, Math.max(0, dt || 0));
      for (const rule of rules) {
        if (!rule.enabled || rule.event.type !== 'interval') continue;
        const period = rule.event.seconds || 5;
        const next = (timers.get(rule.id) || 0) + Math.min(0.05, Math.max(0, dt || 0));
        if (next >= period) { timers.set(rule.id, next % period); runActions(rule, {}); }
        else timers.set(rule.id, next);
      }
    },
    getScore: () => score,
    reset() { timers.clear(); firedOnce.clear(); elapsed = 0; score = 0; stopped = false; api.onScore?.(0, 0); }
  };
}

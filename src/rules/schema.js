// Data-driven world rules. This module is DOM/THREE independent.
export const RULE_LIMITS = Object.freeze({ maxRules: 100, maxActions: 10, maxConditions: 5, maxText: 240 });
export const EVENT_TYPES = Object.freeze([
  { id: 'game_start', label: 'ゲーム開始' },
  { id: 'touch', label: 'パーツに触れた' },
  { id: 'leave', label: 'パーツから離れた' },
  { id: 'interval', label: '一定時間ごと' }
]);
export const CONDITION_TYPES = Object.freeze([
  { id: 'score_compare', label: 'スコアを比較' }
]);
export const ACTION_TYPES = Object.freeze([
  { id: 'add_score', label: 'スコアを加算' },
  { id: 'show_message', label: 'メッセージを表示' },
  { id: 'teleport', label: 'プレイヤーを移動' },
  { id: 'set_checkpoint', label: 'チェックポイント設定' },
  { id: 'respawn', label: 'リスポーン' },
  { id: 'complete', label: 'ゲームクリア' }
]);
const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const text = (v, max = RULE_LIMITS.maxText) => typeof v === 'string' ? v.slice(0, max) : '';
export function createRule() {
  return { id: 'rule-' + Math.random().toString(36).slice(2, 9), enabled: true,
    event: { type: 'touch', target: '' }, conditions: [], actions: [{ type: 'show_message', text: 'ルールが実行されました！' }] };
}
export function normalizeEventRules(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, RULE_LIMITS.maxRules).map((raw, i) => {
    const r = object(raw) ? raw : {};
    const ev = object(r.event) ? r.event : {};
    const type = EVENT_TYPES.some((x) => x.id === ev.type) ? ev.type : 'touch';
    const conditions = (Array.isArray(r.conditions) ? r.conditions : []).slice(0, RULE_LIMITS.maxConditions).filter(object).map((c) => ({
      type: c.type === 'score_compare' ? c.type : 'score_compare',
      op: ['gte', 'lte', 'eq'].includes(c.op) ? c.op : 'gte',
      value: finite(c.value) ? Math.max(-1000000, Math.min(1000000, c.value)) : 0
    }));
    const actions = (Array.isArray(r.actions) ? r.actions : []).slice(0, RULE_LIMITS.maxActions).filter(object).map((a) => {
      const type = ACTION_TYPES.some((x) => x.id === a.type) ? a.type : 'show_message';
      if (type === 'add_score') return { type, value: finite(a.value) ? Math.max(-100000, Math.min(100000, a.value)) : 1 };
      if (type === 'teleport' || type === 'set_checkpoint') return { type, target: text(a.target, 80) };
      if (type === 'show_message') return { type, text: text(a.text) };
      return { type };
    });
    return { id: text(r.id, 80) || 'rule-' + (i + 1), enabled: r.enabled !== false,
      event: { type, target: text(ev.target, 80), seconds: finite(ev.seconds) ? Math.max(0.25, Math.min(3600, ev.seconds)) : 5 },
      conditions, actions };
  });
}
export function validateEventRules(input) {
  if (!Array.isArray(input)) return ['ルールは配列で指定してください'];
  if (input.length > RULE_LIMITS.maxRules) return ['ルール数は100件までです'];
  const errors = [];
  input.forEach((r, i) => {
    if (!object(r) || !object(r.event) || !EVENT_TYPES.some((e) => e.id === r.event.type)) errors.push(`ルール${i + 1}: イベントが不正です`);
    if (!Array.isArray(r.actions) || r.actions.length > RULE_LIMITS.maxActions) errors.push(`ルール${i + 1}: アクションは1件以上、最大10件にしてください`);
    for (const a of r.actions || []) if (!object(a) || !ACTION_TYPES.some((x) => x.id === a.type)) errors.push(`ルール${i + 1}: 未対応のアクションです`);
  });
  return errors;
}

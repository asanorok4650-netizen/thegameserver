// Data-driven world rules. JSON stores data only; the runtime evaluates a small safe expression tree.
export const RULE_LIMITS = Object.freeze({ maxRules: 100, maxActions: 20, maxConditions: 12, maxText: 240, maxVariables: 30, maxExprDepth: 8 });
export const EVENT_TYPES = Object.freeze([
  { id: 'game_start', label: 'ゲーム開始' }, { id: 'touch', label: 'パーツに触れた' },
  { id: 'leave', label: 'パーツから離れた' }, { id: 'interval', label: '一定時間ごと' }
]);
export const CONDITION_TYPES = Object.freeze([{ id: 'score_compare', label: 'スコアを比較' }]);
export const ACTION_TYPES = Object.freeze([
  { id: 'add_score', label: 'スコアを加算' }, { id: 'show_message', label: 'メッセージを表示' },
  { id: 'teleport', label: 'プレイヤーを移動' }, { id: 'set_checkpoint', label: 'チェックポイント設定' },
  { id: 'respawn', label: 'リスポーン' }, { id: 'complete', label: 'ゲームクリア' },
  { id: 'set_variable', label: '変数に代入' }, { id: 'change_variable', label: '変数を増減' }
]);
const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const text = (v, max = RULE_LIMITS.maxText) => typeof v === 'string' ? v.slice(0, max) : '';
export function createNumber(value = 0) { return { kind: 'number', value: finite(value) ? value : 0 }; }
export function createVariable(name = 'score') { return { kind: 'variable', name: text(name, 40) }; }
export function createMath(op = 'add', left = createNumber(0), right = createNumber(1)) { return { kind: 'math', op, left, right }; }
export function createCompare(op = 'gte', left = createVariable('score'), right = createNumber(10)) { return { kind: 'compare', op, left, right }; }
export function createLogic(op = 'and', items = [createCompare(), createCompare('lte', createVariable('score'), createNumber(100))]) { return { kind: 'logic', op, items }; }
const MATH_OPS = ['add','sub','mul','div','mod'];
const CMP_OPS = ['gte','lte','eq','neq','gt','lt'];
export function normalizeExpression(raw, depth = 0) {
  if (depth > RULE_LIMITS.maxExprDepth || !object(raw)) return createNumber(0);
  if (raw.kind === 'variable') return createVariable(raw.name || 'value');
  if (raw.kind === 'math') return { kind: 'math', op: MATH_OPS.includes(raw.op) ? raw.op : 'add', left: normalizeExpression(raw.left, depth + 1), right: normalizeExpression(raw.right, depth + 1) };
  if (raw.kind === 'compare') return { kind: 'compare', op: CMP_OPS.includes(raw.op) ? raw.op : 'gte', left: normalizeExpression(raw.left, depth + 1), right: normalizeExpression(raw.right, depth + 1) };
  if (raw.kind === 'logic') return { kind: 'logic', op: ['and','or','not'].includes(raw.op) ? raw.op : 'and', items: (Array.isArray(raw.items) ? raw.items : []).slice(0, 6).map((x) => normalizeExpression(x, depth + 1)) };
  return createNumber(clamp(finite(raw.value) ? raw.value : 0, -1000000, 1000000));
}
export function createRule() {
  return { id: 'rule-' + Math.random().toString(36).slice(2, 9), enabled: true,
    event: { type: 'touch', target: '' }, conditions: [], actions: [{ type: 'show_message', text: 'ルールが実行されました！' }] };
}
export function normalizeEventRules(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, RULE_LIMITS.maxRules).map((raw, i) => {
    const r = object(raw) ? raw : {}, ev = object(r.event) ? r.event : {};
    const type = EVENT_TYPES.some((x) => x.id === ev.type) ? ev.type : 'touch';
    const conditions = (Array.isArray(r.conditions) ? r.conditions : []).slice(0, RULE_LIMITS.maxConditions).filter(object).map((c) => ({
      type: 'score_compare', op: ['gte','lte','eq'].includes(c.op) ? c.op : 'gte',
      value: finite(c.value) ? clamp(c.value, -1000000, 1000000) : 0
    }));
    const actions = (Array.isArray(r.actions) ? r.actions : []).slice(0, RULE_LIMITS.maxActions).filter(object).map((a) => {
      const actionType = ACTION_TYPES.some((x) => x.id === a.type) ? a.type : 'show_message';
      if (actionType === 'add_score') return { type: actionType, value: finite(a.value) ? clamp(a.value, -100000, 100000) : 1, ...(a.expression ? { expression: normalizeExpression(a.expression) } : {}) };
      if (actionType === 'set_variable' || actionType === 'change_variable') return { type: actionType, name: text(a.name, 40) || 'value', expression: normalizeExpression(a.expression || createNumber(1)) };
      if (actionType === 'teleport' || actionType === 'set_checkpoint') return { type: actionType, target: text(a.target, 80) };
      if (actionType === 'show_message') return { type: actionType, text: text(a.text) };
      return { type: actionType };
    });
    const variables = (Array.isArray(r.variables) ? r.variables : []).slice(0, RULE_LIMITS.maxVariables).filter(object).map((v) => ({
      name: text(v.name, 40).replace(/[^a-zA-Z0-9_ぁ-んァ-ヶ一-龠]/g, '').slice(0,40) || 'value',
      initial: finite(v.initial) ? clamp(v.initial, -1000000, 1000000) : 0
    }));
    return { id: text(r.id, 80) || 'rule-' + (i + 1), enabled: r.enabled !== false,
      event: { type, target: text(ev.target, 80), seconds: finite(ev.seconds) ? clamp(ev.seconds, 0.25, 3600) : 5 },
      conditions, ...(r.conditionTree ? { conditionTree: normalizeExpression(r.conditionTree) } : {}),
      ...(variables.length ? { variables } : {}), actions };
  });
}
export function validateEventRules(input) {
  if (!Array.isArray(input)) return ['ルールは配列で指定してください'];
  if (input.length > RULE_LIMITS.maxRules) return ['ルール数は100件までです'];
  const errors = [];
  input.forEach((r, i) => {
    if (!object(r) || !object(r.event) || !EVENT_TYPES.some((e) => e.id === r.event.type)) errors.push(`ルール${i + 1}: イベントが不正です`);
    if (!Array.isArray(r.actions) || r.actions.length > RULE_LIMITS.maxActions) errors.push(`ルール${i + 1}: アクション数が上限を超えています`);
    for (const a of r.actions || []) if (!object(a) || !ACTION_TYPES.some((x) => x.id === a.type)) errors.push(`ルール${i + 1}: 未対応のアクションです`);
    if (r.conditionTree && !object(r.conditionTree)) errors.push(`ルール${i + 1}: 条件式が不正です`);
  });
  return errors;
}

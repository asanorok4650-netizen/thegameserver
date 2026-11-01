// Data-driven world rules. JSON stores data only; the runtime evaluates a small safe expression tree.
export const RULE_LIMITS = Object.freeze({
  maxRules: 100, maxActions: 20, maxSteps: 50, maxConditions: 12,
  maxText: 240, maxVariables: 30, maxExprDepth: 8, maxStepDepth: 5, maxRepeat: 50
});
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
const MATH_OPS = ['add','sub','mul','div','mod'];
const CMP_OPS = ['gte','lte','eq','neq','gt','lt'];

export function createNumber(value = 0) { return { kind: 'number', value: finite(value) ? value : 0 }; }
export function createVariable(name = 'score') { return { kind: 'variable', name: text(name, 40) }; }
export function createMath(op = 'add', left = createNumber(0), right = createNumber(1)) { return { kind: 'math', op, left, right }; }
export function createCompare(op = 'gte', left = createVariable('score'), right = createNumber(10)) { return { kind: 'compare', op, left, right }; }
export function createLogic(op = 'and', items = [createCompare(), createCompare('lte', createVariable('score'), createNumber(100))]) { return { kind: 'logic', op, items }; }

export function normalizeExpression(raw, depth = 0) {
  if (depth > RULE_LIMITS.maxExprDepth || !object(raw)) return createNumber(0);
  if (raw.kind === 'variable') return createVariable(raw.name);
  if (raw.kind === 'math') return { kind: 'math', op: MATH_OPS.includes(raw.op) ? raw.op : 'add', left: normalizeExpression(raw.left, depth + 1), right: normalizeExpression(raw.right, depth + 1) };
  if (raw.kind === 'compare') return { kind: 'compare', op: CMP_OPS.includes(raw.op) ? raw.op : 'gte', left: normalizeExpression(raw.left, depth + 1), right: normalizeExpression(raw.right, depth + 1) };
  if (raw.kind === 'logic') return { kind: 'logic', op: ['and','or','not'].includes(raw.op) ? raw.op : 'and', items: (Array.isArray(raw.items) ? raw.items : []).slice(0, 6).map((x) => normalizeExpression(x, depth + 1)) };
  return createNumber(clamp(finite(raw.value) ? raw.value : 0, -1000000, 1000000));
}

function normalizeAction(raw) {
  const a = object(raw) ? raw : {};
  const actionType = ACTION_TYPES.some((x) => x.id === a.type) ? a.type : 'show_message';
  if (actionType === 'add_score') return { type: actionType, value: finite(a.value) ? clamp(a.value, -100000, 100000) : 1, ...(a.expression ? { expression: normalizeExpression(a.expression) } : {}) };
  if (actionType === 'set_variable' || actionType === 'change_variable') return { type: actionType, name: text(a.name, 40), expression: normalizeExpression(a.expression || createNumber(1)) };
  if (actionType === 'teleport' || actionType === 'set_checkpoint') return { type: actionType, target: text(a.target, 80) };
  if (actionType === 'show_message') return { type: actionType, text: text(a.text) };
  return { type: actionType };
}
function normalizeStep(raw, depth = 0) {
  const step = object(raw) ? raw : {};
  if (step.type === 'if') return {
    type: 'if', condition: normalizeExpression(step.condition),
    then: normalizeSteps(step.then, depth + 1), else: normalizeSteps(step.else, depth + 1)
  };
  if (step.type === 'repeat') return {
    type: 'repeat', count: finite(step.count) ? clamp(Math.floor(step.count), 0, RULE_LIMITS.maxRepeat) : 1,
    body: normalizeSteps(step.body, depth + 1)
  };
  return normalizeAction(step);
}
function normalizeSteps(input, depth = 0) {
  if (!Array.isArray(input) || depth > RULE_LIMITS.maxStepDepth) return [];
  return input.slice(0, RULE_LIMITS.maxSteps).map((step) => normalizeStep(step, depth));
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
    const actions = (Array.isArray(r.actions) ? r.actions : []).slice(0, RULE_LIMITS.maxActions).filter(object).map(normalizeAction);
    const variables = (Array.isArray(r.variables) ? r.variables : []).slice(0, RULE_LIMITS.maxVariables).filter(object).map((v) => ({
      name: text(v.name, 40),
      initial: finite(v.initial) ? clamp(v.initial, -1000000, 1000000) : 0
    }));
    return {
      id: text(r.id, 80) || 'rule-' + (i + 1), enabled: r.enabled !== false,
      event: { type, target: text(ev.target, 80), seconds: finite(ev.seconds) ? clamp(ev.seconds, 0.25, 3600) : 5 },
      conditions, ...(r.conditionTree ? { conditionTree: normalizeExpression(r.conditionTree) } : {}),
      ...(variables.length ? { variables } : {}), actions,
      ...(Array.isArray(r.steps) ? { steps: normalizeSteps(r.steps) } : {})
    };
  });
}

function inspectExpression(node, path, references, errors, depth = 0) {
  if (!object(node) || depth > RULE_LIMITS.maxExprDepth) { errors.push(path + ': 式の形式または入れ子の深さが不正です'); return; }
  if (node.kind === 'number') {
    if (!finite(node.value)) errors.push(path + ': 数値が不正です');
  } else if (node.kind === 'variable') {
    if (typeof node.name !== 'string' || !node.name) errors.push(path + ': 変数名を入力してください');
    else references.push({ name: node.name, path });
  } else if (node.kind === 'math') {
    if (!MATH_OPS.includes(node.op)) errors.push(path + ': 計算演算子が不正です');
    inspectExpression(node.left, path + '.左辺', references, errors, depth + 1);
    inspectExpression(node.right, path + '.右辺', references, errors, depth + 1);
  } else if (node.kind === 'compare') {
    if (!CMP_OPS.includes(node.op)) errors.push(path + ': 比較演算子が不正です');
    inspectExpression(node.left, path + '.左辺', references, errors, depth + 1);
    inspectExpression(node.right, path + '.右辺', references, errors, depth + 1);
  } else if (node.kind === 'logic') {
    if (!['and','or','not'].includes(node.op) || !Array.isArray(node.items) || (node.op === 'not' && node.items.length !== 1)) errors.push(path + ': 論理演算ブロックが不正です');
    (Array.isArray(node.items) ? node.items : []).forEach((item, i) => inspectExpression(item, path + '.条件' + (i + 1), references, errors, depth + 1));
  } else errors.push(path + ': 未対応の式ブロックです');
}
function inspectAction(action, path, references, errors) {
  if (!object(action) || !ACTION_TYPES.some((x) => x.id === action.type)) { errors.push(path + ': 未対応のアクションです'); return; }
  if (action.type === 'set_variable' || action.type === 'change_variable') {
    if (typeof action.name !== 'string' || !action.name) errors.push(path + ': 代入先の変数名を入力してください');
    else if (action.name === 'score') errors.push(path + ': score は読み取り専用です。スコア加算ブロックを使ってください');
    else references.push({ name: action.name, path });
  }
  if (action.expression) inspectExpression(action.expression, path + '.式', references, errors);
  if (action.type === 'show_message' && typeof action.text === 'string') {
    const matcher = /\{([A-Za-z_ぁ-んァ-ヶ一-龠][A-Za-z0-9_ぁ-んァ-ヶ一-龠]*)\}/g;
    let match;
    while ((match = matcher.exec(action.text))) references.push({ name: match[1], path: path + '.メッセージ' });
  }
}
function inspectSteps(steps, path, references, errors, depth = 0) {
  if (!Array.isArray(steps) || steps.length > RULE_LIMITS.maxSteps || depth > RULE_LIMITS.maxStepDepth) {
    errors.push(path + ': ブロック数または入れ子の深さが上限を超えています'); return;
  }
  steps.forEach((step, i) => {
    const at = path + ' / ブロック' + (i + 1);
    if (!object(step)) { errors.push(at + ': ブロックが不正です'); return; }
    if (step.type === 'if') {
      inspectExpression(step.condition, at + ' の条件', references, errors);
      inspectSteps(step.then || [], at + ' / true', references, errors, depth + 1);
      inspectSteps(step.else || [], at + ' / false', references, errors, depth + 1);
    } else if (step.type === 'repeat') {
      if (!Number.isInteger(step.count) || step.count < 0 || step.count > RULE_LIMITS.maxRepeat) errors.push(at + ': 繰り返し回数は0〜' + RULE_LIMITS.maxRepeat + 'にしてください');
      inspectSteps(step.body || [], at + ' / 繰り返し', references, errors, depth + 1);
    } else inspectAction(step, at, references, errors);
  });
}

export function validateEventRules(input) {
  if (!Array.isArray(input)) return ['ルールは配列で指定してください'];
  if (input.length > RULE_LIMITS.maxRules) return ['ルール数は100件までです'];
  const errors = [], references = [], declared = new Set();
  let variableCount = 0;
  input.forEach((r, i) => {
    const prefix = 'ルール' + (i + 1);
    if (!object(r) || !object(r.event) || !EVENT_TYPES.some((e) => e.id === r.event.type)) errors.push(prefix + ': イベントが不正です');
    if (r && r.steps !== undefined) {
      inspectSteps(r.steps, prefix, references, errors);
    } else {
      if (!r || !Array.isArray(r.actions) || r.actions.length > RULE_LIMITS.maxActions) errors.push(prefix + ': アクション数が上限を超えています');
      (r && Array.isArray(r.actions) ? r.actions : []).forEach((a, ai) => inspectAction(a, prefix + ' / アクション' + (ai + 1), references, errors));
    }
    if (r && r.conditionTree) inspectExpression(r.conditionTree, prefix + ' / ルール条件', references, errors);
    if (r && r.variables !== undefined && !Array.isArray(r.variables)) errors.push(prefix + ': 変数一覧が配列ではありません');
    for (const variable of (r && Array.isArray(r.variables) ? r.variables : [])) {
      variableCount++;
      const name = variable && variable.name;
      if (typeof name !== 'string' || !/^([A-Za-z_ぁ-んァ-ヶ一-龠])([A-Za-z0-9_ぁ-んァ-ヶ一-龠]){0,39}$/.test(name)) {
        errors.push(prefix + ': 変数名「' + String(name ?? '') + '」は英字・数字・日本語・_で入力してください（先頭は英字・日本語・_）');
      } else if (name === 'score') errors.push(prefix + ': score は組み込み変数のため宣言できません');
      else if (declared.has(name)) errors.push('変数名「' + name + '」が重複しています');
      else declared.add(name);
      if (!variable || !finite(variable.initial)) errors.push(prefix + ': 変数「' + String(name ?? '') + '」の初期値が不正です');
    }
  });
  if (variableCount > RULE_LIMITS.maxVariables) errors.push('変数は全体で' + RULE_LIMITS.maxVariables + '個までです');
  for (const ref of references) {
    if (ref.name !== 'score' && !declared.has(ref.name)) errors.push(ref.path + ': 変数「' + ref.name + '」が宣言されていません');
  }
  return [...new Set(errors)].slice(0, 40);
}

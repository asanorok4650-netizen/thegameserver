// Blocklyの保存JSONを、安全なデータ専用IRへ変換する。生成コードは実行しない。
const MAX_BLOCKS = 2000;
const MAX_DEPTH = 32;
const MAX_TEXT = 500;
const MAX_NAME = 64;
const MAX_NUMBER = 1e9;

const NUMBER_BLOCKS = new Set([
  'rbxl_number', 'math_number', 'math_modulo', 'math_single',
  'math_arithmetic', 'variables_get'
]);
const BOOLEAN_BLOCKS = new Set([
  'rbxl_compare', 'logic_compare', 'logic_operation',
  'logic_negate', 'logic_boolean'
]);

export function compileBlocklyWorkspace(workspace) {
  if (!workspace || typeof workspace !== 'object' || !Array.isArray(workspace.blocks?.blocks)) {
    return { version: 1, variables: [], events: [], errors: ['Blocklyワークスペースの形式が不正です'] };
  }

  let count = 0;
  const errors = [];
  const report = (message) => { if (errors.length < 20) errors.push(message); };
  const variables = new Map((Array.isArray(workspace.variables) ? workspace.variables : []).map((v) => [v.id, v.name]));
  const field = (block, name, fallback = '') => block?.fields?.[name] ?? fallback;
  const numericField = (block, name, fallback = 0) => {
    const raw = field(block, name, fallback);
    const number = Number(raw);
    if (!Number.isFinite(number)) {
      report(`数値フィールドが不正です: ${block?.type || 'unknown'}.${name}`);
      return 0;
    }
    return Math.max(-MAX_NUMBER, Math.min(MAX_NUMBER, number));
  };
  const variableName = (block) => {
    const raw = field(block, 'VAR');
    const id = raw && typeof raw === 'object' ? raw.id : raw;
    const name = variables.get(id) || (raw && typeof raw === 'object' ? raw.name : '');
    if (typeof name === 'string' && name.trim()) return name.slice(0, MAX_NAME);
    report('変数ブロックの参照先が見つかりません');
    return 'value';
  };
  const expressionType = (block) => {
    if (NUMBER_BLOCKS.has(block?.type)) return 'Number';
    if (BOOLEAN_BLOCKS.has(block?.type)) return 'Boolean';
    return 'Unknown';
  };
  const value = (block, name, depth, expected = 'Number') => {
    const child = block.inputs?.[name]?.block;
    if (!child) return expected === 'Boolean' ? { op: 'boolean', value: false } : { op: 'number', value: 0 };
    const actual = expressionType(child);
    if (actual !== 'Unknown' && actual !== expected) {
      report(`入力型エラー: ${block.type}.${name} は ${expected} が必要ですが ${actual} が接続されています`);
    }
    return expression(child, depth + 1);
  };

  function expression(block, depth) {
    if (!block) return { op: 'number', value: 0 };
    if (depth > MAX_DEPTH) {
      report('ブロックの入れ子が上限32階層を超えています');
      return { op: 'number', value: 0 };
    }
    if (++count > MAX_BLOCKS) {
      report('ブロック数が上限2000個を超えています');
      return { op: 'number', value: 0 };
    }
    switch (block.type) {
      case 'rbxl_number': return { op: 'number', value: numericField(block, 'VALUE') };
      case 'math_number': return { op: 'number', value: numericField(block, 'NUM') };
      case 'math_modulo': return { op: 'math', operator: 'mod', a: value(block, 'DIVIDEND', depth), b: value(block, 'DIVISOR', depth) };
      case 'math_single': return { op: 'unary', operator: field(block, 'OP', 'ABS'), value: value(block, 'NUM', depth) };
      case 'math_arithmetic': {
        const operators = { ADD: 'add', MINUS: 'sub', MULTIPLY: 'mul', DIVIDE: 'div', POWER: 'pow' };
        const raw = field(block, 'OP', 'ADD');
        if (!operators[raw]) report('未対応の計算演算子: ' + raw);
        return { op: 'math', operator: operators[raw] || 'add', a: value(block, 'A', depth), b: value(block, 'B', depth) };
      }
      case 'rbxl_compare':
      case 'logic_compare': {
        const map = { EQ: 'eq', NEQ: 'neq', GT: 'gt', LT: 'lt', GTE: 'gte', LTE: 'lte', EQUAL: 'eq', NOTEQUAL: 'neq' };
        const raw = field(block, 'OP', 'EQ');
        if (!map[raw]) report('未対応の比較演算子: ' + raw);
        return { op: 'compare', operator: map[raw] || 'eq', a: value(block, 'A', depth), b: value(block, 'B', depth) };
      }
      case 'logic_operation': {
        const raw = field(block, 'OP', 'AND');
        if (raw !== 'AND' && raw !== 'OR') report('未対応の論理演算子: ' + raw);
        return { op: raw === 'OR' ? 'or' : 'and', a: value(block, 'A', depth, 'Boolean'), b: value(block, 'B', depth, 'Boolean') };
      }
      case 'logic_negate': return { op: 'not', value: value(block, 'BOOL', depth, 'Boolean') };
      case 'logic_boolean': return { op: 'boolean', value: field(block, 'BOOL') === 'TRUE' };
      case 'variables_get': return { op: 'variable', name: variableName(block) };
      default:
        report('未対応の値ブロック: ' + String(block.type));
        return { op: 'number', value: 0 };
    }
  }

  function sequence(first, depth = 0) {
    const out = [];
    let block = first;
    while (block && depth <= MAX_DEPTH && count <= MAX_BLOCKS) {
      if (++count > MAX_BLOCKS) {
        report('ブロック数が上限2000個を超えています');
        break;
      }
      const inputs = block.inputs || {};
      const child = (name) => inputs[name]?.block || null;
      switch (block.type) {
        case 'rbxl_wait': out.push({ op: 'wait', seconds: value(block, 'SECONDS', depth) }); break;
        case 'rbxl_if':
        case 'rbxl_if_else':
          out.push({ op: 'if', condition: value(block, 'CONDITION', depth, 'Boolean'), then: sequence(child('DO'), depth + 1), otherwise: sequence(child('ELSE'), depth + 1) }); break;
        case 'controls_if': {
          const branches = [];
          for (let i = 0; i < 32 && (inputs['IF' + i] || inputs['DO' + i]); i++) branches.push(i);
          let tail = sequence(child('ELSE'), depth + 1);
          for (let k = branches.length - 1; k >= 0; k--) {
            const i = branches[k];
            tail = [{ op: 'if', condition: value(block, 'IF' + i, depth, 'Boolean'), then: sequence(child('DO' + i), depth + 1), otherwise: tail }];
          }
          out.push(...tail); break;
        }
        case 'rbxl_repeat':
          out.push({ op: 'repeat', times: { op: 'number', value: Math.max(0, Math.min(1000, Math.floor(numericField(block, 'TIMES')))) }, body: sequence(child('DO'), depth + 1) }); break;
        case 'controls_repeat_ext':
          out.push({ op: 'repeat', times: value(block, 'TIMES', depth), body: sequence(child('DO'), depth + 1) }); break;
        case 'rbxl_forever': out.push({ op: 'forever', body: sequence(child('DO'), depth + 1) }); break;
        case 'rbxl_add_score': out.push({ op: 'addScore', amount: value(block, 'VALUE', depth) }); break;
        case 'rbxl_show_message': out.push({ op: 'message', text: String(field(block, 'TEXT', '')).slice(0, MAX_TEXT) }); break;
        case 'rbxl_set_variable':
          out.push({ op: 'setVariable', name: String(field(block, 'NAME', 'value')).slice(0, MAX_NAME), value: value(block, 'VALUE', depth) }); break;
        case 'rbxl_set_named_variable':
        case 'rbxl_change_variable':
        case 'variables_set': {
          const name = variableName(block);
          out.push({ op: block.type === 'rbxl_change_variable' ? 'changeVariable' : 'setVariable', name, value: value(block, 'VALUE', depth) }); break;
        }
        case 'rbxl_part_visible':
          out.push({ op: 'partVisible', part: String(field(block, 'PART', '')).slice(0, 100), visible: field(block, 'VISIBLE') === true || field(block, 'VISIBLE') === 'TRUE' }); break;
        case 'rbxl_move_part':
          out.push({ op: 'movePart', part: String(field(block, 'PART', '')).slice(0, 100), position: ['X','Y','Z'].map((k) => numericField(block, k)) }); break;
        case 'rbxl_set_checkpoint': out.push({ op: 'checkpoint' }); break;
        case 'rbxl_teleport': out.push({ op: 'teleportToPart', part: String(field(block, 'PART', '')).slice(0, 100) }); break;
        case 'rbxl_respawn': out.push({ op: 'respawn' }); break;
        case 'rbxl_complete': out.push({ op: 'complete' }); break;
        default:
          report('未対応の処理ブロック: ' + String(block.type));
      }
      block = block.next?.block || null;
    }
    if (block && depth > MAX_DEPTH) report('ブロックの入れ子が上限32階層を超えています');
    return out;
  }

  const events = [];
  const eventMap = {
    rbxl_when_start: 'start', rbxl_when_touch: 'touch', rbxl_when_leave: 'leave',
    rbxl_when_player_spawn: 'spawn', rbxl_when_interval: 'interval'
  };
  for (const root of workspace.blocks.blocks) {
    const event = eventMap[root.type];
    if (!event) {
      report('未対応のトップレベルブロック: ' + String(root.type));
      continue;
    }
    const seconds = Math.max(0.1, Math.min(3600, numericField(root, 'SECONDS', 1) || 1));
    events.push({
      event,
      target: String(field(root, 'PART', '')).slice(0, 100),
      seconds,
      body: sequence(root.next?.block || null, 0)
    });
  }

  const outputVariables = (Array.isArray(workspace.variables) ? workspace.variables : [])
    .filter((v) => v && typeof v.name === 'string' && v.name.trim())
    .map((v) => ({ name: v.name.slice(0, MAX_NAME), initial: 0 }));
  return { version: 1, variables: outputVariables, events, errors };
}

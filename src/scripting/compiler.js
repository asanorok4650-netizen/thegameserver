// Blocklyの保存JSONを、安全なデータ専用IRへ変換する。生成コードは実行しない。
const MAX_BLOCKS = 2000;
const MAX_DEPTH = 32;
const MAX_TEXT = 500;

export function compileBlocklyWorkspace(workspace) {
  if (!workspace || typeof workspace !== 'object' || !Array.isArray(workspace.blocks?.blocks)) {
    return { version: 1, events: [], errors: [] };
  }
  let count = 0;
  const errors = [];
  const variables = new Map((workspace.variables || []).map((v) => [v.id, v.name]));
  const field = (block, name, fallback = '') => block.fields?.[name] ?? fallback;
  const variableName = (block) => {
    const raw = field(block, 'VAR');
    const id = raw && typeof raw === 'object' ? raw.id : raw;
    return variables.get(id) || (raw && typeof raw === 'object' ? raw.name : '') || 'value';
  };
  const value = (block, name, depth) => {
    const child = block.inputs?.[name]?.block;
    return child ? expression(child, depth + 1) : { op: 'number', value: 0 };
  };
  function expression(block, depth) {
    if (!block || depth > MAX_DEPTH || ++count > MAX_BLOCKS) return { op: 'number', value: 0 };
    switch (block.type) {
      case 'rbxl_number':
      case 'math_number': return { op: 'number', value: Number(field(block, 'VALUE', 0)) || 0 };
      case 'math_arithmetic': {
        const op = ({ ADD: 'add', MINUS: 'sub', MULTIPLY: 'mul', DIVIDE: 'div', POWER: 'pow' })[field(block, 'OP')] || 'add';
        return { op: 'math', operator: op, a: value(block, 'A', depth), b: value(block, 'B', depth) };
      }
      case 'rbxl_compare':
      case 'logic_compare': {
        const map = { EQ: 'eq', NEQ: 'neq', GT: 'gt', LT: 'lt', GTE: 'gte', LTE: 'lte', EQUAL: 'eq', NOTEQUAL: 'neq' };
        return { op: 'compare', operator: map[field(block, 'OP')] || 'eq', a: value(block, 'A', depth), b: value(block, 'B', depth) };
      }
      case 'logic_operation': return { op: field(block, 'OP') === 'OR' ? 'or' : 'and', a: value(block, 'A', depth), b: value(block, 'B', depth) };
      case 'logic_negate': return { op: 'not', value: value(block, 'BOOL', depth) };
      case 'logic_boolean': return { op: 'boolean', value: field(block, 'BOOL') === 'TRUE' };
      case 'variables_get': {
        const name = variableName(block);
        return { op: 'variable', name: name === 'value' ? 'score' : name };
      }
      default:
        errors.push('未対応の値ブロック: ' + block.type);
        return { op: 'number', value: 0 };
    }
  }
  function sequence(first, depth = 0) {
    const out = [];
    let block = first;
    while (block && depth <= MAX_DEPTH && count <= MAX_BLOCKS) {
      count++;
      const inputs = block.inputs || {};
      const child = (name) => inputs[name]?.block || null;
      switch (block.type) {
        case 'rbxl_wait': out.push({ op: 'wait', seconds: value(block, 'SECONDS', depth) }); break;
        case 'rbxl_if':
        case 'rbxl_if_else':
          out.push({ op: 'if', condition: value(block, 'CONDITION', depth), then: sequence(child('DO'), depth + 1), otherwise: sequence(child('ELSE'), depth + 1) }); break;
        case 'controls_if': {
          // 標準の「もし」: IF0/DO0, IF1/DO1(でなければもし)…, ELSE。後ろから入れ子の if/otherwise に畳む。
          const branches = [];
          for (let i = 0; i < 32 && (inputs['IF' + i] || inputs['DO' + i]); i++) branches.push(i);
          let tail = sequence(child('ELSE'), depth + 1);
          for (let k = branches.length - 1; k >= 0; k--) {
            const i = branches[k];
            tail = [{ op: 'if', condition: value(block, 'IF' + i, depth), then: sequence(child('DO' + i), depth + 1), otherwise: tail }];
          }
          out.push(...tail); break;
        }
        case 'rbxl_repeat':
        case 'controls_repeat_ext':
          out.push({ op: 'repeat', times: block.type === 'rbxl_repeat' ? { op: 'number', value: Number(field(block, 'TIMES', 0)) || 0 } : value(block, 'TIMES', depth), body: sequence(child('DO'), depth + 1) }); break;
        case 'rbxl_forever': out.push({ op: 'forever', body: sequence(child('DO'), depth + 1) }); break;
        case 'rbxl_add_score': out.push({ op: 'addScore', amount: value(block, 'VALUE', depth) }); break;
        case 'rbxl_show_message': out.push({ op: 'message', text: String(field(block, 'TEXT', '')).slice(0, MAX_TEXT) }); break;
        case 'rbxl_set_variable':
          out.push({ op: 'setVariable', name: String(field(block, 'NAME', 'value')).slice(0, 64), value: value(block, 'VALUE', depth) }); break;
        case 'rbxl_set_named_variable':
        case 'rbxl_change_variable':
        case 'variables_set': {
          const name = variableName(block);
          out.push({ op: block.type === 'rbxl_change_variable' ? 'changeVariable' : 'setVariable', name, value: value(block, 'VALUE', depth) }); break;
        }
        case 'rbxl_part_visible':
          out.push({ op: 'partVisible', part: String(field(block, 'PART', '')).slice(0, 100), visible: field(block, 'VISIBLE') === true || field(block, 'VISIBLE') === 'TRUE' }); break;
        case 'rbxl_move_part':
          out.push({ op: 'movePart', part: String(field(block, 'PART', '')).slice(0, 100), position: ['X','Y','Z'].map((k) => Number(field(block, k, 0)) || 0) }); break;
        case 'rbxl_set_checkpoint': out.push({ op: 'checkpoint' }); break;
        case 'rbxl_teleport': out.push({ op: 'teleportToPart', part: String(field(block, 'PART', '')).slice(0, 100) }); break;
        case 'rbxl_respawn': out.push({ op: 'respawn' }); break;
        case 'rbxl_complete': out.push({ op: 'complete' }); break;
        default:
          if (!String(block.type).startsWith('variables_')) errors.push('未対応の処理ブロック: ' + block.type);
      }
      block = block.next?.block || null;
    }
    return out;
  }

  const events = [];
  for (const root of workspace.blocks.blocks) {
    const eventMap = {
      rbxl_when_start: 'start', rbxl_when_touch: 'touch', rbxl_when_leave: 'leave',
      rbxl_when_player_spawn: 'spawn', rbxl_when_interval: 'interval'
    };
    const event = eventMap[root.type];
    if (!event) continue;
    const seconds = Math.max(0.1, Math.min(3600, Number(field(root, 'SECONDS', 1)) || 1));
    events.push({
      event,
      target: String(field(root, 'PART', '')).slice(0, 100),
      seconds,
      body: sequence(root.next?.block || null, 0)
    });
  }
  if (count > MAX_BLOCKS) errors.push('ブロック数が上限2000個を超えています');
  if (errors.length) errors.splice(20);
  return { version: 1, variables: (workspace.variables || []).map((v) => ({ name: String(v.name || '').slice(0, 64), initial: 0 })), events, errors };
}

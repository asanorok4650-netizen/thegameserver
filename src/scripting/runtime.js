// コンパイル済みIRを実行する安全なインタープリター。任意JavaScriptは評価しない。
const clamp = (n) => Number.isFinite(n) ? Math.max(-1e9, Math.min(1e9, n)) : 0;
const MAX_TASKS = 64;
const MAX_STEPS_PER_TICK = 200;
const MAX_REPEAT = 100;

export function createBlocklyRuntime(program, api = {}) {
  const variables = new Map([['score', 0]]);
  const tasks = [];
  const intervals = new Map();
  let score = 0, elapsed = 0, stopped = false;
  const read = (node) => {
    if (!node || typeof node !== 'object') return 0;
    if (node.op === 'number') return Number(node.value) || 0;
    if (node.op === 'boolean') return !!node.value;
    if (node.op === 'variable') return variables.get(node.name) ?? 0;
    if (node.op === 'not') return !read(node.value);
    if (node.op === 'and') return !!read(node.a) && !!read(node.b);
    if (node.op === 'or') return !!read(node.a) || !!read(node.b);
    if (node.op === 'compare') {
      const a = read(node.a), b = read(node.b);
      switch (node.operator) { case 'neq': return a !== b; case 'gt': return a > b; case 'lt': return a < b; case 'gte': return a >= b; case 'lte': return a <= b; default: return a === b; }
    }
    if (node.op === 'math') {
      const a = Number(read(node.a)) || 0, b = Number(read(node.b)) || 0;
      switch (node.operator) { case 'sub': return clamp(a-b); case 'mul': return clamp(a*b); case 'div': return b ? clamp(a/b) : 0; case 'pow': return clamp(Math.pow(a, Math.max(-16, Math.min(16,b)))); default: return clamp(a+b); }
    }
    return 0;
  };
  function* runSteps(steps, depth = 0) {
    if (depth > 24) return;
    for (const step of steps || []) {
      if (stopped) return;
      switch (step.op) {
        case 'wait': yield Math.max(0, Math.min(60, Number(read(step.seconds)) || 0)); break;
        case 'if': yield 0; yield* runSteps(read(step.condition) ? step.then : step.otherwise, depth+1); break;
        case 'repeat': {
          const n = Math.max(0, Math.min(MAX_REPEAT, Math.floor(Number(read(step.times)) || 0)));
          for (let i=0; i<n && !stopped; i++) yield* runSteps(step.body, depth+1);
          break;
        }
        case 'forever':
          // 1回のフレームに処理が集中しないよう、反復ごとに次フレームへ譲る。
          while (!stopped) { yield 0; yield* runSteps(step.body, depth+1); }
          break;
        case 'addScore': {
          const amount = clamp(read(step.amount)); score = clamp(score + amount);
          variables.set('score', score); api.onScore?.(score, amount); yield 0; break;
        }
        case 'setVariable': variables.set(step.name, clamp(read(step.value))); yield 0; break;
        case 'changeVariable': variables.set(step.name, clamp((variables.get(step.name)||0) + read(step.value))); yield 0; break;
        case 'message': api.onMessage?.(String(step.text || '').replace(/\{([\wぁ-んァ-ヶ一-龠]+)\}/g, (_, n) => String(variables.get(n) ?? 0))); yield 0; break;
        case 'partVisible': if (api.setPartVisible) api.setPartVisible(step.part, !!step.visible); else api.onWarning?.('パーツ表示ブロックはまだ未対応です: ' + step.part); yield 0; break;
        case 'movePart': if (api.movePart) api.movePart(step.part, step.position); else api.onWarning?.('パーツ移動ブロックはまだ未対応です: ' + step.part); yield 0; break;
        case 'checkpoint': api.setCheckpoint?.(); yield 0; break;
        default: yield 0;
      }
    }
  }
  const launch = (event, target, alias) => {
    if (stopped || tasks.length >= MAX_TASKS) return;
    for (const item of program?.events || []) {
      if (item.event !== event || (event === 'touch' && item.target && item.target !== target && item.target !== alias)) continue;
      tasks.push({ iterator: runSteps(item.body), wake: elapsed });
    }
  };
  return {
    start() { launch('start'); },
    onSpawn() { launch('spawn'); },
    onTouch(part) { launch('touch', part?.id, part?.name); },
    update(dt) {
      if (stopped) return;
      elapsed += Math.max(0, Math.min(0.1, dt || 0));
      for (const item of program?.events || []) if (item.event === 'interval') {
        const next = (intervals.get(item) || 0) + Math.max(0, Math.min(0.1, dt || 0));
        if (next >= item.seconds) { intervals.set(item, next % item.seconds); if (tasks.length < MAX_TASKS) tasks.push({ iterator: runSteps(item.body), wake: elapsed }); }
        else intervals.set(item, next);
      }
      let budget = MAX_STEPS_PER_TICK;
      for (let i=tasks.length-1; i>=0 && budget>0; i--) {
        const task = tasks[i];
        if (task.wake > elapsed) continue;
        const result = task.iterator.next();
        budget--;
        if (result.done) tasks.splice(i,1);
        else task.wake = elapsed + Math.max(0, Number(result.value) || 0);
      }
      if (tasks.length > MAX_TASKS) tasks.length = MAX_TASKS;
    },
    reset() { tasks.length = 0; intervals.clear(); variables.clear(); variables.set('score',0); score=0; elapsed=0; stopped=false; api.onScore?.(0,0); },
    getScore: () => score,
    getVariables: () => Object.fromEntries(variables),
    stop() { stopped = true; tasks.length = 0; }
  };
}

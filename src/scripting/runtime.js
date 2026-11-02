// コンパイル済みIRを実行する安全なインタープリター。任意JavaScriptは評価しない。
const clamp = (n) => Number.isFinite(n) ? Math.max(-1e9, Math.min(1e9, n)) : 0;
const MAX_TASKS = 64;
const MAX_STEPS_PER_TICK = 200;
const MAX_WORK_PER_TICK = 4000; // 1フレームで進められる「ブロック実行 + 繰り返し1周」の合計。空の入れ子ループでも画面が固まらない
const MAX_REPEAT = 100;
const MAX_LIST_ITEMS = 100;
const MAX_VALUE_DEPTH = 8;
const MAX_STRING_LENGTH = 500;
const cloneValue = (value, depth = 0) => {
  if (depth > MAX_VALUE_DEPTH) return '';
  if (typeof value === 'string') return value.slice(0, MAX_STRING_LENGTH);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return clamp(value);
  if (Array.isArray(value)) return value.slice(0, MAX_LIST_ITEMS).map((item) => cloneValue(item, depth + 1));
  return '';
};

export function createScriptingRuntime(program, api = {}) {
  const variables = new Map([['score', 0], ...((program?.variables || []).map((v) => [v.name, cloneValue(v.initial)]))]);
  const tasks = [];
  const intervals = new Map();
  let score = 0, elapsed = 0, stopped = false;
  let randomState = (Number(program?.randomSeed ?? api.randomSeed ?? 0x6d2b79f5) >>> 0) || 0x6d2b79f5;
  const random = () => { randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5; return (randomState >>> 0) / 0x100000000; };
  let work = MAX_WORK_PER_TICK;
  const warned = new Set();
  const warnOnce = (message) => { if (!warned.has(message)) { warned.add(message); api.onWarning?.(message); } };
  const read = (node) => {
    if (typeof node === 'number') return Number.isFinite(node) ? node : 0;
    if (!node || typeof node !== 'object') return 0;
    if (node.op === 'number') { const n = Number(node.value); return Number.isFinite(n) ? clamp(n) : 0; }
    if (node.op === 'boolean') return !!node.value;
    if (node.op === 'string') return String(node.value ?? '').slice(0, MAX_STRING_LENGTH);
    if (node.op === 'vector') return (node.values || []).slice(0, 3).map((item) => clamp(Number(read(item))));
    if (node.op === 'partGet') {
      if (typeof api.getPartProperty !== 'function') { warnOnce('パーツ情報の取得APIが利用できません'); return 0; }
      const result = api.getPartProperty(node.part, node.property);
      if (result === null || result === undefined) { warnOnce('パーツ情報を取得できません: ' + String(node.part).slice(0, 100)); return node.property === 'collide' ? false : node.property === 'color' ? '#ffffff' : 0; }
      return cloneValue(result);
    }
    if (node.op === 'variable') return cloneValue(variables.get(node.name) ?? 0);
    if (node.op === 'concat') return (String(read(node.a) ?? '') + String(read(node.b) ?? '')).slice(0, MAX_STRING_LENGTH);
    if (node.op === 'list') return (node.items || []).slice(0, MAX_LIST_ITEMS).map((item) => cloneValue(read(item)));
    if (node.op === 'listLength') { const list = read(node.list); return Array.isArray(list) ? list.length : 0; }
    if (node.op === 'listGet') { const list = read(node.list); const index = Math.floor(Number(read(node.index)) || 0) - 1; return Array.isArray(list) && index >= 0 && index < list.length ? cloneValue(list[index]) : ''; }
    if (node.op === 'elapsed') return elapsed;
    if (node.op === 'random') {
      const min = Number(read(node.min)) || 0, max = Number(read(node.max)) || 0;
      const low = Math.min(min, max), high = Math.max(min, max);
      return Number.isInteger(low) && Number.isInteger(high) ? Math.floor(random() * (high - low + 1)) + low : low + random() * (high - low);
    }
    if (node.op === 'not') return !read(node.value);
    if (node.op === 'and') return !!read(node.a) && !!read(node.b);
    if (node.op === 'or') return !!read(node.a) || !!read(node.b);
    if (node.op === 'compare') {
      const a = read(node.a), b = read(node.b);
      switch (node.operator) { case 'neq': return a !== b; case 'gt': return a > b; case 'lt': return a < b; case 'gte': return a >= b; case 'lte': return a <= b; default: return a === b; }
    }
    if (node.op === 'unary') {
      const n = Number(read(node.value)) || 0;
      switch (node.operator) { case 'ROOT': return clamp(Math.sqrt(Math.max(0,n))); case 'NEG': return clamp(-n); case 'LN': return clamp(Math.log(Math.max(Number.EPSILON,n))); case 'LOG10': return clamp(Math.log10(Math.max(Number.EPSILON,n))); case 'EXP': return clamp(Math.exp(Math.min(20,n))); case 'POW10': return clamp(10 ** Math.min(9,Math.max(-9,n))); default: return clamp(Math.abs(n)); }
    }
    if (node.op === 'math') {
      const a = Number(read(node.a)) || 0, b = Number(read(node.b)) || 0;
      switch (node.operator) { case 'sub': return clamp(a-b); case 'mul': return clamp(a*b); case 'div': return b ? clamp(a/b) : 0; case 'mod': return b ? clamp(a%b) : 0; case 'pow': return clamp(Math.pow(a, Math.max(-16, Math.min(16,b)))); default: return clamp(a+b); }
    }
    warnOnce('未対応の値命令をスキップしました: ' + String(node.op || 'unknown').slice(0, 80));
    return 0;
  };
  function* runSteps(steps, depth = 0) {
    if (depth > 24) return;
    for (const step of steps || []) {
      if (stopped) return;
      while (work <= 0 && !stopped) yield 0; // 今のフレームの作業量を使い切ったら、次のフレームまで譲る
      work--;
      switch (step.op) {
        case 'wait': yield Math.max(0, Math.min(60, Number(read(step.seconds)) || 0)); break;
        case 'if': yield 0; yield* runSteps(read(step.condition) ? step.then : step.otherwise, depth+1); break;
        case 'repeat': {
          const n = Math.max(0, Math.min(MAX_REPEAT, Math.floor(Number(read(step.times)) || 0)));
          for (let i=0; i<n && !stopped; i++) {
            while (work <= 0 && !stopped) yield 0; // 中身が空でも1周ごとに作業量を消費する
            work--;
            yield* runSteps(step.body, depth+1);
          }
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
        case 'setVariable': variables.set(step.name, cloneValue(read(step.value))); yield 0; break;
        case 'changeVariable': variables.set(step.name, clamp((variables.get(step.name)||0) + read(step.value))); yield 0; break;
        case 'message': api.onMessage?.(String(step.text || '').replace(/\{([\wぁ-んァ-ヶ一-龠]+)\}/g, (_, n) => String(variables.get(n) ?? 0))); yield 0; break;
        case 'listAdd': {
          let list = variables.get(step.name);
          if (!Array.isArray(list)) { warnOnce('リスト変数ではないため新しいリストを作成しました: ' + step.name); list = []; }
          if (list.length < MAX_LIST_ITEMS) list.push(cloneValue(read(step.value)));
          else warnOnce('リストの最大要素数100件に達しました: ' + step.name);
          variables.set(step.name, list); yield 0; break;
        }
        case 'listReplace': {
          const list = variables.get(step.name);
          const index = Math.floor(Number(read(step.index)) || 0) - 1;
          if (!Array.isArray(list) || index < 0 || index >= list.length) warnOnce('リストの置換位置が範囲外です: ' + step.name);
          else list[index] = cloneValue(read(step.value));
          yield 0; break;
        }
        case 'partVisible': if (api.setPartVisible) api.setPartVisible(step.part, !!step.visible); else api.onWarning?.('パーツ表示ブロックはまだ未対応です: ' + step.part); yield 0; break;
        case 'movePart': if (api.movePart) api.movePart(step.part, step.position); else api.onWarning?.('パーツ移動ブロックはまだ未対応です: ' + step.part); yield 0; break;
        case 'partSet':
          if (typeof api.setPartProperty === 'function') {
            const accepted = api.setPartProperty(step.part, step.property, read(step.value));
            if (!accepted) warnOnce('パーツのプロパティを変更できません: ' + String(step.part).slice(0, 100) + ' (' + String(step.property).slice(0, 40) + ')');
          } else warnOnce('パーツのプロパティ設定APIが利用できません');
          yield 0; break;
        case 'checkpoint': api.setCheckpoint?.(); yield 0; break;
        case 'teleportToPart': api.teleportToPart?.(step.part); yield 0; break;
        case 'checkpointAtPart': api.checkpointAtPart?.(step.part); yield 0; break;
        case 'respawn': api.respawn?.(); yield 0; break;
        case 'complete': stopped = true; api.complete?.(); return;
        default: warnOnce('未対応の処理命令をスキップしました: ' + String(step.op || 'unknown').slice(0, 80)); yield 0;
      }
    }
  }
  const launch = (event, target, alias) => {
    if (stopped || tasks.length >= MAX_TASKS) return;
    for (const item of program?.events || []) {
      if (item.event !== event || (['touch', 'leave'].includes(event) && item.target && item.target !== target && item.target !== alias)) continue;
      tasks.push({ iterator: runSteps(item.body), wake: elapsed });
    }
  };
  return {
    start() { launch('start'); },
    onSpawn() { launch('spawn'); },
    onTouch(part) { launch('touch', part?.id, part?.name); },
    onLeave(part) { launch('leave', part?.id, part?.name); },
    update(dt) {
      if (stopped) return;
      elapsed += Math.max(0, Math.min(0.1, dt || 0));
      for (const item of program?.events || []) if (item.event === 'interval') {
        const next = (intervals.get(item) || 0) + Math.max(0, Math.min(0.1, dt || 0));
        if (next >= item.seconds) { intervals.set(item, next % item.seconds); if (tasks.length < MAX_TASKS) tasks.push({ iterator: runSteps(item.body), wake: elapsed }); }
        else intervals.set(item, next);
      }
      work = MAX_WORK_PER_TICK;
      let budget = MAX_STEPS_PER_TICK;
      for (let i=0; i<tasks.length && budget>0; i++) {
        const task = tasks[i];
        if (task.wake > elapsed) continue;
        const result = task.iterator.next();
        budget--;
        if (result.done) { tasks.splice(i,1); i--; }
        else task.wake = elapsed + Math.max(0, Number(result.value) || 0);
      }
      if (tasks.length > MAX_TASKS) tasks.length = MAX_TASKS;
    },
    reset() { tasks.length = 0; intervals.clear(); warned.clear(); work = MAX_WORK_PER_TICK; variables.clear(); variables.set('score',0); for (const v of program?.variables || []) variables.set(v.name, cloneValue(v.initial)); randomState = (Number(program?.randomSeed ?? api.randomSeed ?? 0x6d2b79f5) >>> 0) || 0x6d2b79f5; score=0; elapsed=0; stopped=false; api.onScore?.(0,0); },
    getScore: () => score,
    getVariables: () => Object.fromEntries([...variables].map(([name, value]) => [name, cloneValue(value)])),
    stop() { stopped = true; tasks.length = 0; }
  };
}

// Backward-compatible name used by earlier Phase 3 tests and integrations.
export const createBlocklyRuntime = createScriptingRuntime;

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
  const personal = new Map(); // プレイヤーごとの得点(addScore を起こしたイベントのプレイヤーに加算)
  // ブロックの「プレイヤー」が 'local'(または空)のときは「そのイベントを起こしたプレイヤー」。1人プレイでは常に 'local'
  const who = (player, context) => (!player || player === 'local') ? (context?.playerId || 'local') : String(player);
  let randomState = (Number(program?.randomSeed ?? api.randomSeed ?? 0x6d2b79f5) >>> 0) || 0x6d2b79f5;
  const random = () => { randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5; return (randomState >>> 0) / 0x100000000; };
  let work = MAX_WORK_PER_TICK;
  const warned = new Set();
  const warnOnce = (message) => { if (!warned.has(message)) { warned.add(message); api.onWarning?.(message); } };
  const read = (node, context = {}) => {
    if (typeof node === 'number') return Number.isFinite(node) ? node : 0;
    if (!node || typeof node !== 'object') return 0;
    if (node.op === 'number') { const n = Number(node.value); return Number.isFinite(n) ? clamp(n) : 0; }
    if (node.op === 'boolean') return !!node.value;
    if (node.op === 'eventGet') return String(context?.[node.property] ?? '').slice(0, 100);
    if (node.op === 'string') return String(node.value ?? '').slice(0, MAX_STRING_LENGTH);
    if (node.op === 'vector') return (node.values || []).slice(0, 3).map((item) => clamp(Number(read(item, context))));
    if (node.op === 'playerGet') {
      if (typeof api.getPlayerProperty !== 'function') { warnOnce('プレイヤー情報の取得APIが利用できません'); return node.property === 'alive' ? false : 0; }
      const result = api.getPlayerProperty(who(node.player, context), node.property);
      if (result === null || result === undefined) { warnOnce('プレイヤー情報を取得できません: ' + String(node.player).slice(0, 100)); return node.property === 'alive' ? false : 0; }
      return cloneValue(result);
    }
    if (node.op === 'partGet') {
      if (typeof api.getPartProperty !== 'function') { warnOnce('パーツ情報の取得APIが利用できません'); return 0; }
      const result = api.getPartProperty(node.part, node.property);
      if (result === null || result === undefined) { warnOnce('パーツ情報を取得できません: ' + String(node.part).slice(0, 100)); return node.property === 'collide' ? false : node.property === 'color' ? '#ffffff' : 0; }
      return cloneValue(result);
    }
    if (node.op === 'variable') return cloneValue(variables.get(node.name) ?? 0);
    if (node.op === 'concat') return (String(read(node.a, context) ?? '') + String(read(node.b, context) ?? '')).slice(0, MAX_STRING_LENGTH);
    if (node.op === 'list') return (node.items || []).slice(0, MAX_LIST_ITEMS).map((item) => cloneValue(read(item, context)));
    if (node.op === 'listLength') { const list = read(node.list, context); return Array.isArray(list) ? list.length : 0; }
    if (node.op === 'listGet') { const list = read(node.list, context); const index = Math.floor(Number(read(node.index, context)) || 0) - 1; return Array.isArray(list) && index >= 0 && index < list.length ? cloneValue(list[index]) : ''; }
    if (node.op === 'elapsed') return elapsed;
    // イベント起動時刻をタスクのコンテキストに固定しているので、他のイベントの経過時間とは混ざらない。
    if (node.op === 'eventElapsed') return Number.isFinite(context?.startedAt) ? Math.max(0, elapsed - context.startedAt) : 0;
    if (node.op === 'random') {
      const min = Number(read(node.min, context)) || 0, max = Number(read(node.max, context)) || 0;
      const low = Math.min(min, max), high = Math.max(min, max);
      return Number.isInteger(low) && Number.isInteger(high) ? Math.floor(random() * (high - low + 1)) + low : low + random() * (high - low);
    }
    if (node.op === 'not') return !read(node.value, context);
    if (node.op === 'and') return !!read(node.a, context) && !!read(node.b, context);
    if (node.op === 'or') return !!read(node.a, context) || !!read(node.b, context);
    if (node.op === 'compare') {
      const a = read(node.a, context), b = read(node.b, context);
      switch (node.operator) { case 'neq': return a !== b; case 'gt': return a > b; case 'lt': return a < b; case 'gte': return a >= b; case 'lte': return a <= b; default: return a === b; }
    }
    if (node.op === 'unary') {
      const n = Number(read(node.value, context)) || 0;
      switch (node.operator) { case 'ROOT': return clamp(Math.sqrt(Math.max(0,n))); case 'NEG': return clamp(-n); case 'LN': return clamp(Math.log(Math.max(Number.EPSILON,n))); case 'LOG10': return clamp(Math.log10(Math.max(Number.EPSILON,n))); case 'EXP': return clamp(Math.exp(Math.min(20,n))); case 'POW10': return clamp(10 ** Math.min(9,Math.max(-9,n))); default: return clamp(Math.abs(n)); }
    }
    if (node.op === 'math') {
      const a = Number(read(node.a, context)) || 0, b = Number(read(node.b, context)) || 0;
      switch (node.operator) { case 'sub': return clamp(a-b); case 'mul': return clamp(a*b); case 'div': return b ? clamp(a/b) : 0; case 'mod': return b ? clamp(a%b) : 0; case 'pow': return clamp(Math.pow(a, Math.max(-16, Math.min(16,b)))); default: return clamp(a+b); }
    }
    warnOnce('未対応の値命令をスキップしました: ' + String(node.op || 'unknown').slice(0, 80));
    return 0;
  };
  function* runSteps(steps, depth = 0, context = {}) {
    if (depth > 24) return;
    for (const step of steps || []) {
      if (stopped) return;
      while (work <= 0 && !stopped) yield 0; // 今のフレームの作業量を使い切ったら、次のフレームまで譲る
      work--;
      switch (step.op) {
        case 'wait': yield Math.max(0, Math.min(60, Number(read(step.seconds, context)) || 0)); break;
        case 'if': yield 0; yield* runSteps(read(step.condition, context) ? step.then : step.otherwise, depth+1, context); break;
        case 'repeat': {
          const n = Math.max(0, Math.min(MAX_REPEAT, Math.floor(Number(read(step.times, context)) || 0)));
          for (let i=0; i<n && !stopped; i++) {
            while (work <= 0 && !stopped) yield 0; // 中身が空でも1周ごとに作業量を消費する
            work--;
            yield* runSteps(step.body, depth+1, context);
          }
          break;
        }
        case 'forever':
          // 1回のフレームに処理が集中しないよう、反復ごとに次フレームへ譲る。
          while (!stopped) { yield 0; yield* runSteps(step.body, depth+1, context); }
          break;
        case 'addScore': {
          const amount = clamp(read(step.amount, context)); score = clamp(score + amount);
          variables.set('score', score);
          const pid = context.playerId || '';
          if (pid) personal.set(pid, clamp((personal.get(pid) || 0) + amount));
          api.onScore?.(score, amount, pid); yield 0; break;
        }
        case 'setVariable': variables.set(step.name, cloneValue(read(step.value, context))); yield 0; break;
        case 'changeVariable': variables.set(step.name, clamp((variables.get(step.name)||0) + read(step.value, context))); yield 0; break;
        case 'message': api.onMessage?.(String(step.text || '').replace(/\{([\wぁ-んァ-ヶ一-龠]+)\}/g, (_, n) => String(variables.get(n) ?? 0))); yield 0; break;
        case 'listAdd': {
          let list = variables.get(step.name);
          if (!Array.isArray(list)) { warnOnce('リスト変数ではないため新しいリストを作成しました: ' + step.name); list = []; }
          if (list.length < MAX_LIST_ITEMS) list.push(cloneValue(read(step.value, context)));
          else warnOnce('リストの最大要素数100件に達しました: ' + step.name);
          variables.set(step.name, list); yield 0; break;
        }
        case 'listReplace': {
          const list = variables.get(step.name);
          const index = Math.floor(Number(read(step.index, context)) || 0) - 1;
          if (!Array.isArray(list) || index < 0 || index >= list.length) warnOnce('リストの置換位置が範囲外です: ' + step.name);
          else list[index] = cloneValue(read(step.value, context));
          yield 0; break;
        }
        case 'partVisible': if (api.setPartVisible) api.setPartVisible(step.part, !!step.visible); else api.onWarning?.('パーツ表示ブロックはまだ未対応です: ' + step.part); yield 0; break;
        case 'movePart': if (api.movePart) api.movePart(step.part, step.position); else api.onWarning?.('パーツ移動ブロックはまだ未対応です: ' + step.part); yield 0; break;
        case 'playerSet': {
          const accepted = api.setPlayerProperty?.(who(step.player, context), step.property, read(step.value, context));
          if (!accepted) warnOnce('プレイヤーのプロパティを変更できません: ' + String(step.player).slice(0, 100) + ' (' + String(step.property).slice(0, 40) + ')');
          yield 0; break;
        }
        case 'playerDamage': {
          const accepted = api.damagePlayer?.(who(step.player, context), Math.max(0, Number(read(step.amount, context)) || 0));
          if (!accepted) warnOnce('プレイヤーにダメージを適用できません: ' + String(step.player).slice(0, 100));
          yield 0; break;
        }
        case 'playerHeal': {
          const accepted = api.healPlayer?.(who(step.player, context), Math.max(0, Number(read(step.amount, context)) || 0));
          if (!accepted) warnOnce('プレイヤーを回復できません: ' + String(step.player).slice(0, 100));
          yield 0; break;
        }
        case 'partSet':
          if (typeof api.setPartProperty === 'function') {
            const accepted = api.setPartProperty(step.part, step.property, read(step.value, context));
            if (!accepted) warnOnce('パーツのプロパティを変更できません: ' + String(step.part).slice(0, 100) + ' (' + String(step.property).slice(0, 40) + ')');
          } else warnOnce('パーツのプロパティ設定APIが利用できません');
          yield 0; break;
        case 'checkpoint': api.setCheckpoint?.(who('', context)); yield 0; break;
        case 'teleportToPart': { const accepted = api.teleportToPart?.(step.part, who(step.player, context)); if (accepted === false) warnOnce('プレイヤーの移動先またはIDが不正です: ' + String(step.player || 'local')); yield 0; break; }
        case 'checkpointAtPart': api.checkpointAtPart?.(step.part, who('', context)); yield 0; break;
        case 'respawn': { const accepted = api.respawn?.(who(step.player, context)); if (accepted === false) warnOnce('リスポーン対象のプレイヤーIDが不正です: ' + String(step.player || 'local')); yield 0; break; }
        case 'complete':
          // 1人プレイでは、クリアでスクリプト全体が止まる。マルチプレイ(ホスト)ではクリアしたプレイヤーだけの話なので止めない
          if (api.stopsOnComplete?.() !== false) stopped = true;
          api.complete?.(who('', context));
          return;
        default: warnOnce('未対応の処理命令をスキップしました: ' + String(step.op || 'unknown').slice(0, 80)); yield 0;
      }
    }
  }
  const launch = (event, target, alias, details = {}) => {
    if (stopped || tasks.length >= MAX_TASKS) return;
    for (const item of program?.events || []) {
      if (item.event !== event || (['touch', 'leave'].includes(event) && item.target && item.target !== target && item.target !== alias)) continue;
      tasks.push({ iterator: runSteps(item.body, 0, { eventType: event, playerId: details.playerId || '', partId: details.partId || target || '', partName: details.partName || alias || '', startedAt: elapsed }), wake: elapsed });
    }
  };
  return {
    start() { launch('start'); },
    onSpawn(playerId = 'local') { launch('spawn', '', '', { playerId }); },
    onPlayerJoin(playerId) { launch('playerJoin', '', '', { playerId }); },
    onPlayerLeave(playerId) { launch('playerLeave', '', '', { playerId }); },
    onTouch(part, playerId = 'local') { launch('touch', part?.id, part?.name, { playerId, partId: part?.id, partName: part?.name }); },
    onLeave(part, playerId = 'local') { launch('leave', part?.id, part?.name, { playerId, partId: part?.id, partName: part?.name }); },
    update(dt) {
      if (stopped) return;
      elapsed += Math.max(0, Math.min(0.1, dt || 0));
      for (const item of program?.events || []) if (item.event === 'interval') {
        const next = (intervals.get(item) || 0) + Math.max(0, Math.min(0.1, dt || 0));
        if (next >= item.seconds) { intervals.set(item, next % item.seconds); if (tasks.length < MAX_TASKS) tasks.push({ iterator: runSteps(item.body, 0, { eventType: 'interval', playerId: '', partId: '', partName: '', startedAt: elapsed }), wake: elapsed }); }
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
    reset() { tasks.length = 0; intervals.clear(); warned.clear(); work = MAX_WORK_PER_TICK; variables.clear(); variables.set('score',0); for (const v of program?.variables || []) variables.set(v.name, cloneValue(v.initial)); randomState = (Number(program?.randomSeed ?? api.randomSeed ?? 0x6d2b79f5) >>> 0) || 0x6d2b79f5; score=0; elapsed=0; stopped=false; personal.clear(); api.onScore?.(0,0,''); },
    getScore: () => score,
    getPlayerScore: (playerId) => personal.get(String(playerId)) || 0,
    getScores: () => Object.fromEntries(personal),
    getVariables: () => Object.fromEntries([...variables].map(([name, value]) => [name, cloneValue(value)])),
    stop() { stopped = true; tasks.length = 0; }
  };
}

// Backward-compatible name used by earlier Phase 3 tests and integrations.
export const createBlocklyRuntime = createScriptingRuntime;

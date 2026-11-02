import { ACTION_TYPES, EVENT_TYPES, RULE_LIMITS, createCompare, createLogic, createMath, createNumber, createVariable } from '../rules/schema.js';

const uid = () => 'rule-' + Math.random().toString(36).slice(2, 9);
const clone = (v) => JSON.parse(JSON.stringify(v));
const defaults = {
  add_score: { type: 'add_score', value: 1 },
  show_message: { type: 'show_message', text: 'メッセージ' },
  teleport: { type: 'teleport', target: '' },
  set_checkpoint: { type: 'set_checkpoint', target: '' },
  respawn: { type: 'respawn' }, complete: { type: 'complete' },
  set_variable: { type: 'set_variable', name: '', expression: createNumber(0) },
  change_variable: { type: 'change_variable', name: '', expression: createNumber(1) }
};

function ExpressionBlock({ node, onChange, depth = 0 }) {
  const patch = (v) => onChange({ ...node, ...v });
  const child = (key, value) => <ExpressionBlock node={value} depth={depth + 1} onChange={(v) => patch({ [key]: v })} />;
  return <div className={'st-expr st-expr-' + node.kind}>
    <div className="st-expr-head">
      <select value={node.kind} onChange={(e) => {
        const kind = e.target.value;
        onChange(kind === 'variable' ? createVariable('score') : kind === 'math' ? createMath() : kind === 'compare' ? createCompare() : kind === 'logic' ? createLogic() : createNumber());
      }}>
        <option value="number">数値</option><option value="variable">変数</option><option value="math">計算</option><option value="compare">比較</option><option value="logic">論理演算</option>
      </select>
      {node.kind === 'number' && <input type="number" value={node.value} onChange={(e) => patch({ value: Number(e.target.value) || 0 })}/>}
      {node.kind === 'variable' && <input type="text" maxLength="40" value={node.name || ''} placeholder="変数名（例: coins）" onChange={(e) => patch({ name: e.target.value })}/>}
      {node.kind === 'math' && <select value={node.op} onChange={(e) => patch({ op: e.target.value })}><option value="add">＋</option><option value="sub">−</option><option value="mul">×</option><option value="div">÷</option><option value="mod">余り</option></select>}
      {node.kind === 'compare' && <select value={node.op} onChange={(e) => patch({ op: e.target.value })}><option value="gte">≧</option><option value="lte">≦</option><option value="gt">＞</option><option value="lt">＜</option><option value="eq">＝</option><option value="neq">≠</option></select>}
      {node.kind === 'logic' && <select value={node.op} onChange={(e) => patch({ op: e.target.value, items: e.target.value === 'not' ? (node.items || []).slice(0, 1) : node.items })}><option value="and">AND</option><option value="or">OR</option><option value="not">NOT</option></select>}
    </div>
    {['math','compare'].includes(node.kind) && <div className="st-expr-children">{child('left', node.left)}{child('right', node.right)}</div>}
    {node.kind === 'logic' && <div className="st-expr-children">
      {(node.items || []).map((item, i) => <div className="st-expr-child" key={i}><ExpressionBlock node={item} depth={depth + 1} onChange={(v) => patch({ items: node.items.map((x, n) => n === i ? v : x) })}/><button type="button" onClick={() => patch({ items: node.items.filter((_, n) => n !== i) })}>×</button></div>)}
      <button type="button" disabled={node.items.length >= 6 || node.op === 'not'} onClick={() => patch({ items: [...node.items, createCompare()] })}>＋ 条件</button>
    </div>}
  </div>;
}

function getSequenceAtPath(root, path) {
  let sequence = root;
  for (const part of path) {
    const step = sequence[part.index];
    if (!step || !Array.isArray(step[part.key])) return [];
    sequence = step[part.key];
  }
  return sequence;
}
function updateSequenceAtPath(root, path, updater) {
  if (!path.length) return updater(root);
  const [head, ...tail] = path;
  return root.map((step, index) => index === head.index
    ? { ...step, [head.key]: updateSequenceAtPath(step[head.key] || [], tail, updater) }
    : step);
}
function samePathPrefix(a, b) {
  return a.length <= b.length && a.every((part, i) => part.index === b[i].index && part.key === b[i].key);
}
function moveStep(root, source, targetPath) {
  const sourceList = getSequenceAtPath(root, source.path);
  const moving = sourceList[source.index];
  if (!moving) return root;
  // ブロックを自分自身の中へ入れると循環構造になるため禁止。
  if (targetPath.length > source.path.length && samePathPrefix(source.path, targetPath) && targetPath[source.path.length].index === source.index) return root;
  let adjustedTarget = targetPath.map((part) => ({ ...part }));
  // 移動元の削除で、同じ親リスト内にある接続先の index がずれる場合を補正。
  if (source.path.length < adjustedTarget.length && samePathPrefix(source.path, adjustedTarget)) {
    const next = adjustedTarget[source.path.length];
    if (next.index > source.index) next.index -= 1;
  }
  const without = updateSequenceAtPath(root, source.path, (list) => list.filter((_, i) => i !== source.index));
  return updateSequenceAtPath(without, adjustedTarget, (list) => [...list, moving]);
}

function StepSequence({ steps, path, onSequenceChange, onMove, ruleId, depth = 0 }) {
  const add = (step) => onSequenceChange(path, (list) => list.length >= RULE_LIMITS.maxSteps ? list : [...list, step]);
  const drop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const source = JSON.parse(e.dataTransfer.getData('text/plain'));
      if (source.ruleId === ruleId) onMove(source, path);
    } catch (_) { /* ignore invalid drag payload */ }
  };
  return <div className="st-step-sequence">
    {steps.map((step, index) => {
      const update = (patch) => onSequenceChange(path, (list) => list.map((item, i) => i === index ? { ...item, ...patch } : item));
      const remove = () => onSequenceChange(path, (list) => list.filter((_, i) => i !== index));
      const dragStart = (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', JSON.stringify({ ruleId, path, index }));
      };
      if (step.type === 'if') return <article className="st-step-item st-step-if" key={index} draggable onDragStart={dragStart}>
        <header className="st-step-head"><span className="st-step-grip" title="ドラッグして接続">⠿</span><strong>もし / そうでなければ</strong><span className="st-step-spacer"/><button type="button" onClick={remove}>削除</button></header>
        <div className="st-step-content">
          <label className="st-step-label">条件</label>
          <ExpressionBlock node={step.condition || createCompare()} onChange={(condition) => update({ condition })}/>
          <div className="st-step-branch">
            <strong>TRUE の場合</strong>
            <StepSequence steps={step.then || []} path={[...path, { index, key: 'then' }]} onSequenceChange={onSequenceChange} onMove={onMove} ruleId={ruleId} depth={depth + 1}/>
          </div>
          <div className="st-step-branch st-step-else">
            <strong>FALSE の場合</strong>
            <StepSequence steps={step.else || []} path={[...path, { index, key: 'else' }]} onSequenceChange={onSequenceChange} onMove={onMove} ruleId={ruleId} depth={depth + 1}/>
          </div>
        </div>
      </article>;
      if (step.type === 'repeat') return <article className="st-step-item st-step-repeat" key={index} draggable onDragStart={dragStart}>
        <header className="st-step-head"><span className="st-step-grip" title="ドラッグして接続">⠿</span><strong>繰り返す</strong><span className="st-step-spacer"/><button type="button" onClick={remove}>削除</button></header>
        <div className="st-step-content">
          <label className="st-step-label">回数（最大 {RULE_LIMITS.maxRepeat} 回）<input type="number" min="0" max={RULE_LIMITS.maxRepeat} value={step.count} onChange={(e) => update({ count: Math.max(0, Math.min(RULE_LIMITS.maxRepeat, Number(e.target.value) || 0)) })}/></label>
          <div className="st-step-branch"><strong>繰り返す内容</strong>
            <StepSequence steps={step.body || []} path={[...path, { index, key: 'body' }]} onSequenceChange={onSequenceChange} onMove={onMove} ruleId={ruleId} depth={depth + 1}/>
          </div>
        </div>
      </article>;
      return <article className="st-step-item st-step-action" key={index} draggable onDragStart={dragStart}>
        <header className="st-step-head"><span className="st-step-grip" title="ドラッグして接続">⠿</span><strong>アクション</strong><span className="st-step-spacer"/><button type="button" onClick={remove}>削除</button></header>
        <div className="st-step-content">
          <select className="text-input" value={step.type} onChange={(e) => update(clone(defaults[e.target.value] || { type: e.target.value }))}>{ACTION_TYPES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
          {step.type === 'add_score' && <ExpressionBlock node={step.expression || createNumber(step.value)} onChange={(expression) => update({ expression })}/>}
          {['set_variable','change_variable'].includes(step.type) && <><input className="text-input" maxLength="40" value={step.name || ''} aria-label="変数名" placeholder="変数名（例: coins）" onChange={(e) => update({ name: e.target.value })}/><ExpressionBlock node={step.expression || createNumber(0)} onChange={(expression) => update({ expression })}/></>}
          {step.type === 'show_message' && <input className="text-input" maxLength="240" value={step.text || ''} placeholder="変数は {coins} で表示" onChange={(e) => update({ text: e.target.value })}/>}
          {['teleport','set_checkpoint'].includes(step.type) && <input className="text-input" maxLength="80" value={step.target || ''} placeholder="移動先パーツID" onChange={(e) => update({ target: e.target.value })}/>}
        </div>
      </article>;
    })}
    <div className="st-step-dropzone" onDragOver={(e) => e.preventDefault()} onDrop={drop}>ここへドラッグしてブロックを接続（末尾に追加）</div>
    <div className="st-step-adders">
      <button type="button" disabled={steps.length >= RULE_LIMITS.maxSteps} onClick={() => add(clone(defaults.show_message))}>＋ アクション</button>
      <button type="button" disabled={steps.length >= RULE_LIMITS.maxSteps || depth >= RULE_LIMITS.maxStepDepth} onClick={() => add({ type: 'if', condition: createCompare(), then: [], else: [] })}>＋ IF / ELSE</button>
      <button type="button" disabled={steps.length >= RULE_LIMITS.maxSteps || depth >= RULE_LIMITS.maxStepDepth} onClick={() => add({ type: 'repeat', count: 3, body: [] })}>＋ 繰り返し</button>
    </div>
  </div>;
}

export default function BlockEditor({ rules, parts, onChange }) {
  const patchRule = (ri, patch) => onChange(rules.map((r, i) => i === ri ? { ...r, ...patch } : r));
  const patchEvent = (ri, patch) => patchRule(ri, { event: { ...rules[ri].event, ...patch } });
  const partsOptions = parts.map((p) => ({ id: p.id, label: p.name + ' (' + p.id + ')' }));
  const setVariables = (next) => { if (rules.length) patchRule(0, { variables: next }); };
  const sequenceChange = (ri, path, updater) => {
    const root = Array.isArray(rules[ri].steps) ? rules[ri].steps : (rules[ri].actions || []);
    patchRule(ri, { steps: updateSequenceAtPath(root, path, updater) });
  };
  const move = (ri, source, targetPath) => {
    if (!source || !Array.isArray(source.path) || !Number.isInteger(source.index)) return;
    const root = Array.isArray(rules[ri].steps) ? rules[ri].steps : (rules[ri].actions || []);
    const next = moveStep(root, source, targetPath);
    if (next !== root) patchRule(ri, { steps: next });
  };
  return <section className="st-block-editor st-block-editor-compact">
    <header className="st-block-toolbar">
      <div><strong>ビジュアルプログラミング</strong><p className="st-note">条件分岐・繰り返しを組み合わせられます。ブロックをドラッグし、接続先の枠へドロップしてください。</p></div>
      <button className="secondary-button" type="button" disabled={rules.length >= RULE_LIMITS.maxRules} onClick={() => onChange([...rules, { id: uid(), enabled: true, event: { type: 'game_start', seconds: 5 }, conditions: [], actions: [{ type: 'show_message', text: 'ゲーム開始！' }] }])}>＋ ルール</button>
    </header>
    {rules.length > 0 && <section className="st-variable-panel">
      <strong>変数</strong><span className="st-note">全ルールで共有（score は組み込み変数）</span>
      {(rules[0].variables || []).map((v, i) => <div className="st-variable-row" key={i}><input aria-label="変数名" maxLength="40" value={v.name} placeholder="例: coins" onChange={(e) => setVariables(rules[0].variables.map((x, n) => n === i ? { ...x, name: e.target.value } : x))}/><input aria-label="初期値" type="number" value={v.initial} onChange={(e) => setVariables(rules[0].variables.map((x, n) => n === i ? { ...x, initial: Number(e.target.value) || 0 } : x))}/><button type="button" onClick={() => setVariables(rules[0].variables.filter((_, n) => n !== i))}>削除</button></div>)}
      <button className="st-block-add" type="button" disabled={(rules[0].variables || []).length >= RULE_LIMITS.maxVariables} onClick={() => setVariables([...(rules[0].variables || []), { name: '', initial: 0 }])}>＋ 変数</button>
    </section>}
    {!rules.length && <div className="st-block-empty">最初のルールを追加すると、変数とブロックを編集できます。</div>}
    <div className="st-block-workspace st-block-workspace-horizontal">
      {rules.map((rule, ri) => <article className="st-block-rule st-block-rule-compact" key={rule.id}>
        <div className="st-block-rule-head"><strong>ルール {ri + 1}</strong><label className="st-check"><input type="checkbox" checked={rule.enabled !== false} onChange={(e) => patchRule(ri, { enabled: e.target.checked })}/>有効</label><span className="st-spacer"/><button className="secondary-button st-danger" type="button" onClick={() => onChange(rules.filter((_, i) => i !== ri))}>削除</button></div>
        <div className="st-block-flow">
          <section className="st-code-block event"><div className="st-code-block-title"><b>⚡ イベント</b></div>
            <select className="text-input" value={rule.event.type} onChange={(e) => patchEvent(ri, { type: e.target.value })}>{EVENT_TYPES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
            {['touch','leave'].includes(rule.event.type) && <select className="text-input" value={rule.event.target || ''} onChange={(e) => patchEvent(ri, { target: e.target.value })}><option value="">すべてのパーツ</option>{partsOptions.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>}
            {rule.event.type === 'interval' && <label className="st-block-field">間隔（秒）<input className="text-input st-num" type="number" min="0.25" max="3600" step="0.25" value={rule.event.seconds || 5} onChange={(e) => patchEvent(ri, { seconds: Number(e.target.value) || 5 })}/></label>}
          </section>
          <span className="st-flow-arrow">→</span>
          <section className="st-code-block condition"><div className="st-code-block-title"><b>◇ ルール全体の条件</b></div>
            {rule.conditionTree && <ExpressionBlock node={rule.conditionTree} onChange={(v) => patchRule(ri, { conditionTree: v })}/>}
            {!rule.conditionTree && <p className="st-note">条件なし（常に実行）</p>}
            <button className="st-block-add" type="button" onClick={() => patchRule(ri, { conditionTree: rule.conditionTree ? null : createLogic() })}>{rule.conditionTree ? '条件式を解除' : '＋ AND / OR / NOT 条件'}</button>
            {rule.conditions?.map((c, ci) => <div className="st-block-row" key={ci}><span>旧スコア条件</span><select className="text-input" value={c.op} onChange={(e) => patchRule(ri, { conditions: rule.conditions.map((x,n) => n===ci?{...x,op:e.target.value}:x) })}><option value="gte">以上</option><option value="lte">以下</option><option value="eq">等しい</option></select><input className="text-input st-num" type="number" value={c.value} onChange={(e) => patchRule(ri, { conditions: rule.conditions.map((x,n) => n===ci?{...x,value:Number(e.target.value)||0}:x) })}/><button type="button" onClick={() => patchRule(ri, { conditions: rule.conditions.filter((_,n)=>n!==ci) })}>×</button></div>)}
          </section>
          <span className="st-flow-arrow">→</span>
          <section className="st-code-block action"><div className="st-code-block-title"><b>▶ 制御・アクション</b></div>
            <StepSequence steps={Array.isArray(rule.steps) ? rule.steps : (rule.actions || [])} path={[]} ruleId={rule.id} onSequenceChange={(path, updater) => sequenceChange(ri, path, updater)} onMove={(source, targetPath) => move(ri, source, targetPath)}/>
          </section>
        </div>
      </article>)}
    </div>
  </section>;
}

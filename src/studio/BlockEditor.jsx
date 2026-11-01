import { ACTION_TYPES, EVENT_TYPES, createCompare, createLogic, createMath, createNumber, createVariable } from '../rules/schema.js';

const uid = () => 'rule-' + Math.random().toString(36).slice(2, 9);
const clone = (v) => JSON.parse(JSON.stringify(v));
const defaults = {
  add_score: { type: 'add_score', value: 1 },
  show_message: { type: 'show_message', text: 'メッセージ' },
  teleport: { type: 'teleport', target: '' },
  set_checkpoint: { type: 'set_checkpoint', target: '' },
  respawn: { type: 'respawn' }, complete: { type: 'complete' },
  set_variable: { type: 'set_variable', name: 'value', expression: createNumber(0) },
  change_variable: { type: 'change_variable', name: 'value', expression: createNumber(1) }
};

function ExpressionBlock({ node, onChange, variables, depth = 0 }) {
  const patch = (v) => onChange({ ...node, ...v });
  const child = (key, value) => <ExpressionBlock node={value} variables={variables} depth={depth + 1} onChange={(v) => patch({ [key]: v })} />;
  return <div className={`st-expr st-expr-${node.kind}`}>
    <div className="st-expr-head">
      <select value={node.kind} onChange={(e) => {
        const kind = e.target.value;
        onChange(kind === 'variable' ? createVariable(variables[0] || 'score') : kind === 'math' ? createMath() : kind === 'compare' ? createCompare() : kind === 'logic' ? createLogic() : createNumber());
      }}>
        <option value="number">数値</option><option value="variable">変数</option><option value="math">計算</option><option value="compare">比較</option><option value="logic">論理演算</option>
      </select>
      {node.kind === 'number' && <input type="number" value={node.value} onChange={(e) => patch({ value: Number(e.target.value) || 0 })}/>}
      {node.kind === 'variable' && <select value={node.name} onChange={(e) => patch({ name: e.target.value })}>{variables.map((v) => <option key={v} value={v}>{v}</option>)}</select>}
      {node.kind === 'math' && <select value={node.op} onChange={(e) => patch({ op: e.target.value })}><option value="add">＋</option><option value="sub">−</option><option value="mul">×</option><option value="div">÷</option><option value="mod">余り</option></select>}
      {node.kind === 'compare' && <select value={node.op} onChange={(e) => patch({ op: e.target.value })}><option value="gte">≧</option><option value="lte">≦</option><option value="gt">＞</option><option value="lt">＜</option><option value="eq">＝</option><option value="neq">≠</option></select>}
      {node.kind === 'logic' && <select value={node.op} onChange={(e) => patch({ op: e.target.value })}><option value="and">AND</option><option value="or">OR</option><option value="not">NOT</option></select>}
    </div>
    {['math','compare'].includes(node.kind) && <div className="st-expr-children">{child('left', node.left)}{child('right', node.right)}</div>}
    {node.kind === 'logic' && <div className="st-expr-children">
      {(node.items || []).map((item, i) => <div className="st-expr-child" key={i}><ExpressionBlock node={item} variables={variables} depth={depth + 1} onChange={(v) => patch({ items: node.items.map((x, n) => n === i ? v : x) })}/><button type="button" onClick={() => patch({ items: node.items.filter((_, n) => n !== i) })}>×</button></div>)}
      <button type="button" disabled={node.items.length >= 6 || node.op === 'not'} onClick={() => patch({ items: [...node.items, createCompare()] })}>＋ 条件</button>
    </div>}
  </div>;
}

export default function BlockEditor({ rules, parts, onChange }) {
  const patchRule = (ri, patch) => onChange(rules.map((r, i) => i === ri ? { ...r, ...patch } : r));
  const patchEvent = (ri, patch) => patchRule(ri, { event: { ...rules[ri].event, ...patch } });
  const patchAction = (ri, ai, patch) => patchRule(ri, { actions: rules[ri].actions.map((a, i) => i === ai ? { ...a, ...patch } : a) });
  const variables = [...new Set(['score', ...rules.flatMap((r) => (r.variables || []).map((v) => v.name))])];
  const partsOptions = parts.map((p) => ({ id: p.id, label: p.name + ' (' + p.id + ')' }));
  const setVariables = (next) => {
    if (!rules.length) return;
    patchRule(0, { variables: next });
  };
  return <section className="st-block-editor st-block-editor-compact">
    <header className="st-block-toolbar">
      <div><strong>ビジュアルプログラミング</strong><p className="st-note">イベント・条件・アクションを横に組み立てます。式ブロックは入れ子にできます。</p></div>
      <button className="secondary-button" type="button" disabled={rules.length >= 100} onClick={() => onChange([...rules, { id: uid(), enabled: true, event: { type: 'game_start', seconds: 5 }, conditions: [], actions: [{ type: 'show_message', text: 'ゲーム開始！' }] }])}>＋ ルール</button>
    </header>
    {rules.length > 0 && <section className="st-variable-panel">
      <strong>変数</strong><span className="st-note">全ルールで共有（score は組み込み変数）</span>
      {(rules[0].variables || []).map((v, i) => <div className="st-variable-row" key={i}><input aria-label="変数名" value={v.name} onChange={(e) => setVariables(rules[0].variables.map((x, n) => n === i ? { ...x, name: e.target.value } : x))}/><input aria-label="初期値" type="number" value={v.initial} onChange={(e) => setVariables(rules[0].variables.map((x, n) => n === i ? { ...x, initial: Number(e.target.value) || 0 } : x))}/><button type="button" onClick={() => setVariables(rules[0].variables.filter((_, n) => n !== i))}>削除</button></div>)}
      <button className="st-block-add" type="button" disabled={(rules[0].variables || []).length >= 30} onClick={() => setVariables([...(rules[0].variables || []), { name: 'variable' + ((rules[0].variables || []).length + 1), initial: 0 }])}>＋ 変数</button>
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
          <section className="st-code-block condition"><div className="st-code-block-title"><b>◇ 条件</b></div>
            {rule.conditionTree && <ExpressionBlock node={rule.conditionTree} variables={variables} onChange={(v) => patchRule(ri, { conditionTree: v })}/>}
            {!rule.conditionTree && <p className="st-note">条件なし（常に実行）</p>}
            <button className="st-block-add" type="button" onClick={() => patchRule(ri, { conditionTree: rule.conditionTree ? null : createLogic() })}>{rule.conditionTree ? '条件式を解除' : '＋ AND / OR / NOT 条件'}</button>
            {rule.conditions?.map((c, ci) => <div className="st-block-row" key={ci}><span>旧スコア条件</span><select className="text-input" value={c.op} onChange={(e) => patchRule(ri, { conditions: rule.conditions.map((x,n) => n===ci?{...x,op:e.target.value}:x) })}><option value="gte">以上</option><option value="lte">以下</option><option value="eq">等しい</option></select><input className="text-input st-num" type="number" value={c.value} onChange={(e) => patchRule(ri, { conditions: rule.conditions.map((x,n) => n===ci?{...x,value:Number(e.target.value)||0}:x) })}/><button type="button" onClick={() => patchRule(ri, { conditions: rule.conditions.filter((_,n)=>n!==ci) })}>×</button></div>)}
          </section>
          <span className="st-flow-arrow">→</span>
          <section className="st-code-block action"><div className="st-code-block-title"><b>▶ アクション</b></div>
            {rule.actions.map((a, ai) => <div className="st-block-action" key={ai}>
              <div className="st-block-row"><select className="text-input" value={a.type} onChange={(e) => patchAction(ri, ai, clone(defaults[e.target.value] || { type: e.target.value }))}>{ACTION_TYPES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select><button type="button" onClick={() => patchRule(ri, { actions: rule.actions.filter((_,n)=>n!==ai) })}>×</button></div>
              {a.type === 'add_score' && <ExpressionBlock node={a.expression || createNumber(a.value)} variables={variables} onChange={(v) => patchAction(ri, ai, { expression: v })}/>}
              {['set_variable','change_variable'].includes(a.type) && <><input className="text-input" value={a.name} aria-label="変数名" placeholder="変数名" onChange={(e) => patchAction(ri, ai, { name: e.target.value })}/><ExpressionBlock node={a.expression || createNumber(0)} variables={variables} onChange={(v)=>patchAction(ri,ai,{expression:v})}/></>}
              {a.type === 'show_message' && <input className="text-input" maxLength="240" value={a.text || ''} placeholder="変数は {name} で表示" onChange={(e)=>patchAction(ri,ai,{text:e.target.value})}/>}
              {['teleport','set_checkpoint'].includes(a.type) && <select className="text-input" value={a.target || ''} onChange={(e)=>patchAction(ri,ai,{target:e.target.value})}><option value="">移動先を選択</option>{partsOptions.map((p)=><option key={p.id} value={p.id}>{p.label}</option>)}</select>}
            </div>)}
            <button className="st-block-add" type="button" disabled={rule.actions.length >= 20} onClick={()=>patchRule(ri,{actions:[...rule.actions,{type:'show_message',text:'メッセージ'}]})}>＋ アクション</button>
          </section>
        </div>
      </article>)}
    </div>
  </section>;
}

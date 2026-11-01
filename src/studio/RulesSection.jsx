import { ACTION_TYPES, CONDITION_TYPES, EVENT_TYPES, createRule } from '../rules/schema.js';
const select = (value, options, onChange) => <select className="text-input" value={value} onChange={(e) => onChange(e.target.value)}>{options.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>;
export default function RulesSection({ rules, parts, onChange }) {
  const patchRule = (index, patch) => onChange(rules.map((r, i) => i === index ? { ...r, ...patch } : r));
  const patchEvent = (index, patch) => patchRule(index, { event: { ...rules[index].event, ...patch } });
  const patchAction = (ri, ai, patch) => patchRule(ri, { actions: rules[ri].actions.map((a, i) => i === ai ? { ...a, ...patch } : a) });
  const patchCondition = (ri, ci, patch) => patchRule(ri, { conditions: rules[ri].conditions.map((c, i) => i === ci ? { ...c, ...patch } : c) });
  const partOptions = [{ id: '', label: 'すべてのパーツ' }, ...parts.map((p) => ({ id: p.id, label: p.name + ' (' + p.id + ')' }))];
  return <section className="st-rules">
    <div className="st-row"><strong>イベントルール</strong><span className="st-spacer"/><button className="secondary-button" type="button" disabled={rules.length >= 100} onClick={() => onChange([...rules, createRule()])}>＋ ルール追加</button></div>
    <p className="st-note">イベントが発生すると条件を確認し、上から順番にアクションを実行します。コードは保存せず、安全な定義済み操作だけを使用します。</p>
    {!rules.length && <p className="st-empty">ルールはまだありません。追加すると、ゲーム開始やパーツ接触をきっかけに動作を設定できます。</p>}
    {rules.map((rule, ri) => <div className="st-rule-card" key={rule.id}>
      <div className="st-row"><strong>ルール {ri + 1}</strong><label className="st-check"><input type="checkbox" checked={rule.enabled !== false} onChange={(e) => patchRule(ri, { enabled: e.target.checked })}/>有効</label><span className="st-spacer"/><button className="secondary-button st-danger" type="button" onClick={() => onChange(rules.filter((_, i) => i !== ri))}>削除</button></div>
      <label className="st-field"><span className="st-label">イベント</span>{select(rule.event.type, EVENT_TYPES, (type) => patchEvent(ri, { type }))}</label>
      {['touch', 'leave'].includes(rule.event.type) && <label className="st-field"><span className="st-label">対象パーツ</span>{select(rule.event.target || '', partOptions, (target) => patchEvent(ri, { target }))}</label>}
      {rule.event.type === 'interval' && <label className="st-field"><span className="st-label">間隔（秒）</span><input className="text-input st-num" type="number" min="0.25" max="3600" step="0.25" value={rule.event.seconds || 5} onChange={(e) => patchEvent(ri, { seconds: Number(e.target.value) || 5 })}/></label>}
      <div className="st-rule-sub"><div className="st-row"><strong>条件（すべて満たす）</strong><span className="st-spacer"/><button className="secondary-button" type="button" disabled={rule.conditions.length >= 5} onClick={() => patchRule(ri, { conditions: [...rule.conditions, { type: 'score_compare', op: 'gte', value: 10 }] })}>＋ 条件</button></div>
      {rule.conditions.map((c, ci) => <div className="st-row" key={ci}><span className="st-note">スコア</span>{select(c.op, [{id:'gte',label:'以上'},{id:'lte',label:'以下'},{id:'eq',label:'と等しい'}], (op) => patchCondition(ri, ci, { op }))}<input className="text-input st-num" type="number" value={c.value} onChange={(e) => patchCondition(ri, ci, { value: Number(e.target.value) || 0 })}/><button className="secondary-button st-danger" type="button" onClick={() => patchRule(ri, { conditions: rule.conditions.filter((_, i) => i !== ci) })}>削除</button></div>)}
      </div>
      <div className="st-rule-sub"><div className="st-row"><strong>アクション</strong><span className="st-spacer"/><button className="secondary-button" type="button" disabled={rule.actions.length >= 10} onClick={() => patchRule(ri, { actions: [...rule.actions, { type: 'show_message', text: 'メッセージ' }] })}>＋ アクション</button></div>
      {rule.actions.map((a, ai) => <div className="st-action" key={ai}><div className="st-row">{select(a.type, ACTION_TYPES, (type) => patchAction(ri, ai, type === 'add_score' ? { type, value: 1 } : ['teleport','set_checkpoint'].includes(type) ? { type, target: '' } : type === 'show_message' ? { type, text: '' } : { type }))}<span className="st-spacer"/><button className="secondary-button st-danger" type="button" onClick={() => patchRule(ri, { actions: rule.actions.filter((_, i) => i !== ai) })}>削除</button></div>
      {a.type === 'add_score' && <input aria-label="加算スコア" className="text-input st-num" type="number" value={a.value} onChange={(e) => patchAction(ri, ai, { value: Number(e.target.value) || 0 })}/>}
      {a.type === 'show_message' && <input aria-label="表示メッセージ" className="text-input" maxLength={240} value={a.text || ''} placeholder="表示するメッセージ" onChange={(e) => patchAction(ri, ai, { text: e.target.value })}/>}
      {['teleport','set_checkpoint'].includes(a.type) && <label className="st-field"><span className="st-label">移動先パーツ</span>{select(a.target || '', partOptions.filter((x) => x.id), (target) => patchAction(ri, ai, { target }))}</label>}
      </div>)}
      {rule.actions.length === 0 && <p className="st-note warn">アクションを1つ以上追加してください。</p>}</div>
    </div>)}
  </section>;
}

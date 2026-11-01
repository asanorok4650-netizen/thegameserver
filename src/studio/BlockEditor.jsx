import { ACTION_TYPES, EVENT_TYPES } from '../rules/schema.js';

const ACTION_DEFAULTS = {
  add_score: { type: 'add_score', value: 1 },
  show_message: { type: 'show_message', text: 'メッセージ' },
  teleport: { type: 'teleport', target: '' },
  set_checkpoint: { type: 'set_checkpoint', target: '' },
  respawn: { type: 'respawn' },
  complete: { type: 'complete' }
};

const CONDITION_DEFAULTS = { type: 'score_compare', op: 'gte', value: 10 };
const uid = () => 'rule-' + Math.random().toString(36).slice(2, 9);
const copy = (value) => JSON.parse(JSON.stringify(value));

export default function BlockEditor({ rules, parts, onChange }) {
  const patchRule = (ri, patch) => onChange(rules.map((r, i) => i === ri ? { ...r, ...patch } : r));
  const patchEvent = (ri, patch) => patchRule(ri, { event: { ...rules[ri].event, ...patch } });
  const patchCondition = (ri, ci, patch) => patchRule(ri, { conditions: rules[ri].conditions.map((c, i) => i === ci ? { ...c, ...patch } : c) });
  const patchAction = (ri, ai, patch) => patchRule(ri, { actions: rules[ri].actions.map((a, i) => i === ai ? { ...a, ...patch } : a) });
  const move = (ri, key, index, delta) => {
    const list = rules[ri][key].slice();
    const to = index + delta;
    if (to < 0 || to >= list.length) return;
    [list[index], list[to]] = [list[to], list[index]];
    patchRule(ri, { [key]: list });
  };
  const partOptions = parts.map((p) => ({ id: p.id, label: p.name + ' (' + p.id + ')' }));

  return <section className="st-block-editor">
    <header className="st-block-toolbar">
      <div><strong>ブロックエディタ</strong><p className="st-note">ブロックを縦につなげて、イベント → 条件 → アクションの順にルールを作ります。</p></div>
      <button className="secondary-button" type="button" disabled={rules.length >= 100}
        onClick={() => onChange([...rules, { id: uid(), enabled: true, event: { type: 'game_start', target: '', seconds: 5 }, conditions: [], actions: [{ type: 'show_message', text: 'ゲーム開始！' }] }])}>＋ ルール</button>
    </header>
    {!rules.length && <div className="st-block-empty"><strong>ルールがありません</strong><p>「＋ ルール」から最初のイベントブロックを追加できます。</p></div>}
    <div className="st-block-workspace">
      {rules.map((rule, ri) => <article className="st-block-rule" key={rule.id}>
        <div className="st-block-rule-head">
          <strong>ルール {ri + 1}</strong>
          <label className="st-check"><input type="checkbox" checked={rule.enabled !== false} onChange={(e) => patchRule(ri, { enabled: e.target.checked })}/>有効</label>
          <span className="st-spacer"/>
          <button className="secondary-button" type="button" disabled={ri === 0} onClick={() => { const next = rules.slice(); [next[ri - 1], next[ri]] = [next[ri], next[ri - 1]]; onChange(next); }}>↑</button>
          <button className="secondary-button" type="button" disabled={ri === rules.length - 1} onClick={() => { const next = rules.slice(); [next[ri + 1], next[ri]] = [next[ri], next[ri + 1]]; onChange(next); }}>↓</button>
          <button className="secondary-button st-danger" type="button" onClick={() => onChange(rules.filter((_, i) => i !== ri))}>削除</button>
        </div>

        <div className="st-block-stack">
          <section className="st-code-block event">
            <div className="st-code-block-title"><span>⚡</span><strong>イベント</strong><small>いつ実行する？</small></div>
            <select className="text-input" value={rule.event.type} onChange={(e) => patchEvent(ri, { type: e.target.value })}>
              {EVENT_TYPES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
            {['touch', 'leave'].includes(rule.event.type) && <select className="text-input" value={rule.event.target || ''} onChange={(e) => patchEvent(ri, { target: e.target.value })}>
              <option value="">すべてのパーツ</option>{partOptions.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>}
            {rule.event.type === 'interval' && <label className="st-block-field">間隔（秒）<input className="text-input st-num" type="number" min="0.25" max="3600" step="0.25" value={rule.event.seconds || 5} onChange={(e) => patchEvent(ri, { seconds: Number(e.target.value) || 5 })}/></label>}
          </section>

          <div className="st-block-connector"><span>↓</span></div>
          <section className="st-code-block condition">
            <div className="st-code-block-title"><span>◇</span><strong>条件</strong><small>すべて満たしたら進む（AND）</small></div>
            {rule.conditions.map((c, ci) => <div className="st-block-row" key={ci}>
              <span className="st-block-index">条件 {ci + 1}</span>
              <span>スコア</span>
              <select className="text-input" value={c.op} onChange={(e) => patchCondition(ri, ci, { op: e.target.value })}>
                <option value="gte">以上</option><option value="lte">以下</option><option value="eq">と等しい</option>
              </select>
              <input className="text-input st-num" type="number" value={c.value} onChange={(e) => patchCondition(ri, ci, { value: Number(e.target.value) || 0 })}/>
              <button className="secondary-button st-danger" type="button" onClick={() => patchRule(ri, { conditions: rule.conditions.filter((_, i) => i !== ci) })}>×</button>
              <span className="st-block-order"><button type="button" disabled={ci === 0} onClick={() => move(ri, 'conditions', ci, -1)}>↑</button><button type="button" disabled={ci === rule.conditions.length - 1} onClick={() => move(ri, 'conditions', ci, 1)}>↓</button></span>
            </div>)}
            <button className="st-block-add" type="button" disabled={rule.conditions.length >= 5} onClick={() => patchRule(ri, { conditions: [...rule.conditions, copy(CONDITION_DEFAULTS)] })}>＋ 条件ブロック</button>
          </section>

          <div className="st-block-connector"><span>↓</span></div>
          <section className="st-code-block action">
            <div className="st-code-block-title"><span>▶</span><strong>アクション</strong><small>上から順番に実行</small></div>
            {rule.actions.map((a, ai) => <div className="st-block-action" key={ai}>
              <div className="st-block-row">
                <select className="text-input" value={a.type} onChange={(e) => patchAction(ri, ai, copy(ACTION_DEFAULTS[e.target.value] || { type: e.target.value }))}>
                  {ACTION_TYPES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                </select>
                <span className="st-spacer"/>
                <span className="st-block-order"><button type="button" disabled={ai === 0} onClick={() => move(ri, 'actions', ai, -1)}>↑</button><button type="button" disabled={ai === rule.actions.length - 1} onClick={() => move(ri, 'actions', ai, 1)}>↓</button></span>
                <button className="secondary-button st-danger" type="button" onClick={() => patchRule(ri, { actions: rule.actions.filter((_, i) => i !== ai) })}>削除</button>
              </div>
              {a.type === 'add_score' && <label className="st-block-field">加算するスコア<input className="text-input st-num" type="number" value={a.value} onChange={(e) => patchAction(ri, ai, { value: Number(e.target.value) || 0 })}/></label>}
              {a.type === 'show_message' && <label className="st-block-field">表示メッセージ<input className="text-input" maxLength="240" value={a.text || ''} onChange={(e) => patchAction(ri, ai, { text: e.target.value })}/></label>}
              {['teleport', 'set_checkpoint'].includes(a.type) && <label className="st-block-field">移動先パーツ<select className="text-input" value={a.target || ''} onChange={(e) => patchAction(ri, ai, { target: e.target.value })}><option value="">選択してください</option>{partOptions.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>}
            </div>)}
            <button className="st-block-add" type="button" disabled={rule.actions.length >= 10} onClick={() => patchRule(ri, { actions: [...rule.actions, { type: 'show_message', text: 'メッセージ' }] })}>＋ アクションブロック</button>
          </section>
        </div>
      </article>)}
    </div>
  </section>;
}

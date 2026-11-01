import { useEffect, useRef, useState } from 'react';
import { useStudio } from './useStudio.js';
import { StudioViewport } from './viewport.js';
import { checkDoc } from './model.js';
import TransformFields from './Transform.jsx';
import { SHAPES } from '../tgw/validate.js';
import { LOGICS, getLogicDefinition, getLogicDefaults } from '../logics/index.js';

const SHAPE_LABEL = { block: '箱', ball: '球', cylinder: '円柱', wedge: 'くさび', corner: '角くさび' };
const GRID_STEPS = [0, 0.5, 1, 2, 4];
const fmt = (v) => (Math.round(v * 1000) / 1000).toString();

function Inspector({ parts, grid, logic, onPatch, onRemove, onDuplicate }) {
  if (!parts.length) return <p className="st-empty">パーツを選ぶと、ここで編集できます。<br />(ビューでタップ / 「パーツ」タブから選択)</p>;
  const ids = parts.map((p) => p.id);
  const one = parts.length === 1 ? parts[0] : null;
  const first = parts[0];
  return (
    <div className="st-inspector">
      <div className="st-row">
        <strong>{one ? one.name : `${parts.length}個を選択中`}</strong>
        <span className="st-spacer" />
        <button className="secondary-button" type="button" onClick={() => onDuplicate(ids)}>複製</button>
        <button className="secondary-button st-danger" type="button" onClick={() => onRemove(ids)}>削除</button>
      </div>
      {one && (
        <>
          <label className="st-field"><span className="st-label">名前</span>
            <input className="text-input" value={one.name} maxLength={100} onChange={(e) => onPatch(ids, { name: e.target.value }, 'name-' + one.id)} /></label>
          <TransformFields key={one.id} part={one} grid={grid} onPatch={onPatch} />
        </>
      )}
      <label className="st-field"><span className="st-label">形</span>
        <select className="text-input" value={one ? one.shape : ''} onChange={(e) => onPatch(ids, { shape: e.target.value })}>
          {!one && <option value="">(混在)</option>}
          {[...SHAPES].map((s) => <option key={s} value={s}>{SHAPE_LABEL[s] || s}</option>)}
        </select></label>
      <label className="st-field"><span className="st-label">色</span>
        <input className="st-color" type="color" value={first.color} onChange={(e) => onPatch(ids, { color: e.target.value }, 'color')} /></label>
      <label className="st-field"><span className="st-label">透明度 {fmt(first.transparency)}</span>
        <input type="range" min="0" max="1" step="0.05" value={first.transparency} onChange={(e) => onPatch(ids, { transparency: Number(e.target.value) }, 'alpha')} /></label>
      <label className="st-check"><input type="checkbox" checked={first.collide} onChange={(e) => onPatch(ids, { collide: e.target.checked })} /> 当たり判定あり</label>
      {one && (
        <div className="st-field">
          <span className="st-label">ロジックタグ</span>
          {logic?.tags?.length ? (
            <div className="st-tag-options">
              {logic.tags.map((tag) => (
                <label className="st-tag-option" key={tag.id} title={tag.description || ''}>
                  <input type="checkbox" checked={(one.tags || []).includes(tag.id)}
                    onChange={(e) => {
                      const current = new Set(one.tags || []);
                      if (e.target.checked) current.add(tag.id); else current.delete(tag.id);
                      onPatch(ids, { tags: [...current] }, 'tags-' + one.id);
                    }} />
                  <span><strong>{tag.label}</strong><small>{tag.id}</small></span>
                </label>
              ))}
            </div>
          ) : <p className="st-note">ワールド設定でロジックを選ぶと、利用できるタグが表示されます。</p>}
          <label className="st-field"><span className="st-label">追加タグ(カンマ区切り)</span>
            <input className="text-input" defaultValue={(one.tags || []).filter((t) => !logic?.tags?.some((x) => x.id === t)).join(', ')} key={one.id + '-custom-tags'}
              onBlur={(e) => {
                const custom = e.target.value.split(',').map((t) => t.trim()).filter(Boolean);
                const known = (one.tags || []).filter((t) => logic?.tags?.some((x) => x.id === t));
                onPatch(ids, { tags: [...known, ...custom] }, 'custom-tags-' + one.id);
              }} />
          </label>
        </div>
      )}
    </div>
  );
}

export default function StudioPage({ onExit }) {
  const st = useStudio();
  const { doc, selection, actions } = st;
  const hostRef = useRef(null);
  const vpRef = useRef(null);
  const fileRef = useRef(null);
  const [tab, setTab] = useState('select');
  const [grid, setGrid] = useState(1);
  const [filter, setFilter] = useState('');
  const sel = new Set(selection);
  const selected = doc.parts.filter((p) => sel.has(p.id));
  const check = checkDoc(doc);

  // ビューポートの生成/破棄(最新のハンドラを ref 経由で渡す)
  const pickRef = useRef(null);
  pickRef.current = (id, additive) => { actions.select(id, additive); if (id) setTab('select'); };
  useEffect(() => {
    const vp = new StudioViewport(hostRef.current, { onPick: (id, add) => pickRef.current(id, add) });
    vpRef.current = vp;
    return () => { vp.dispose(); vpRef.current = null; };
  }, []);
  useEffect(() => { if (vpRef.current) vpRef.current.setDoc(doc); }, [doc]);
  useEffect(() => { if (vpRef.current) vpRef.current.setSelection(selection); }, [selection, doc]);
  // 下書き復元/ファイルを開いた直後に全体を映す(パーツ数が一気に変わった時だけ)
  const lastCount = useRef(-1);
  useEffect(() => {
    if (!st.ready) return;
    const jump = lastCount.current < 0 || Math.abs(doc.parts.length - lastCount.current) > 20;
    lastCount.current = doc.parts.length;
    if (jump && vpRef.current) vpRef.current.focusAll();
  }, [st.ready, doc.parts.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // キーボードショートカット
  useEffect(() => {
    const onKey = (e) => {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? actions.redo() : actions.undo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); actions.redo(); }
      else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); if (selection.length) actions.duplicate(selection); }
      else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); st.saveLocal(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length) { e.preventDefault(); actions.remove(selection); }
      else if (e.key === 'f' || e.key === 'F') vpRef.current && vpRef.current.focusSelection();
      else if (selection.length && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const s = grid > 0 ? grid : 0.5;
        const d = e.key === 'ArrowLeft' ? [-s, 0, 0] : e.key === 'ArrowRight' ? [s, 0, 0] : e.key === 'ArrowUp' ? (e.shiftKey ? [0, s, 0] : [0, 0, -s]) : (e.shiftKey ? [0, -s, 0] : [0, 0, s]);
        actions.nudge(selection, d);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, selection, grid, st]);

  function addShape(shape) {
    // 画面中央(カメラが注目している点)の地面に置く
    let at = vpRef.current ? vpRef.current.getTarget() : [0, 0, 0];
    if (grid > 0) at = at.map((v) => Math.round(v / grid) * grid);
    actions.add(shape, [at[0], 0, at[2]]);
    setTab('select');
  }

  function confirmPublish() {
    if (check.errors.length) { st.say(check.errors.join(' / '), 'error'); return; }
    const lines = [`「${doc.name}」を公開します。`, doc.publishedId ? '公開済みのワールドを更新します。' : '', ...check.warnings.map((w) => '・' + w)].filter(Boolean);
    if (window.confirm(lines.join('\n'))) st.publish();
  }

  function leave() {
    if (st.dirty && !window.confirm('このブラウザに保存していない変更があります。閉じますか?(下書きは自動保存されます)')) return;
    onExit();
  }

  const list = filter ? doc.parts.filter((p) => (p.name + ' ' + p.id).toLowerCase().includes(filter.toLowerCase())) : doc.parts;
  const shown = list.slice(0, 300);

  return (
    <div className="studio-root">
      <div className="studio-toolbar">
        <button className="game-chip st-chip" onClick={leave}>← 戻る</button>
        <strong className="st-title">{doc.name}{st.dirty ? ' •' : ''}</strong>
        <span className="st-spacer" />
        <button className="st-btn" disabled={!st.canUndo} onClick={actions.undo} title="元に戻す (Ctrl+Z)">↶</button>
        <button className="st-btn" disabled={!st.canRedo} onClick={actions.redo} title="やり直す (Ctrl+Y)">↷</button>
        <select className="st-select" value={grid} onChange={(e) => setGrid(Number(e.target.value))} aria-label="グリッド">
          {GRID_STEPS.map((g) => <option key={g} value={g}>{g === 0 ? 'スナップなし' : `グリッド ${g}`}</option>)}
        </select>
        <button className="st-btn" onClick={() => fileRef.current && fileRef.current.click()} disabled={st.busy}>開く</button>
        <input ref={fileRef} type="file" accept=".tgw,.rbxl" hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) st.open(f); }} />
        <button className="st-btn" onClick={st.saveLocal}>保存</button>
        <button className="st-btn" onClick={st.exportFile} disabled={st.busy}>.tgw</button>
        <button className="primary-button st-publish" onClick={confirmPublish} disabled={st.busy}>公開</button>
      </div>

      <div className="studio-body">
        <div className="studio-view">
          <div className="studio-canvas" ref={hostRef} />
          <div className="studio-addbar">
            {[...SHAPES].map((s) => <button key={s} className="game-chip" onClick={() => addShape(s)}>＋{SHAPE_LABEL[s]}</button>)}
            <button className="game-chip" onClick={() => vpRef.current && vpRef.current.focusAll()}>全体</button>
          </div>
          <div className="studio-hint">ドラッグ: 回転 / Shift+ドラッグ・2本指: 移動 / ホイール・ピンチ: ズーム / タップ: 選択(Shift: 追加)</div>
        </div>

        <aside className="studio-side">
          <div className="st-tabs">
            {[['select', '選択'], ['parts', `パーツ ${doc.parts.length}`], ['world', 'ワールド']].map(([k, label]) => (
              <button key={k} className={`st-tab${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>{label}</button>
            ))}
          </div>
          <div className="st-panel">
            {tab === 'select' && <Inspector parts={selected} grid={grid} logic={getLogicDefinition(doc.logic?.id)} onPatch={actions.patch} onRemove={actions.remove} onDuplicate={actions.duplicate} />}
            {tab === 'parts' && (
              <div>
                <input className="text-input" placeholder="名前で絞り込み" value={filter} onChange={(e) => setFilter(e.target.value)} />
                <ul className="st-list">
                  {shown.map((p) => (
                    <li key={p.id}>
                      <button className={`st-item${sel.has(p.id) ? ' on' : ''}`} onClick={(e) => { actions.select(p.id, e.shiftKey || e.ctrlKey || e.metaKey); }}>
                        <span className="st-swatch" style={{ background: p.color }} />{p.name}<small>{SHAPE_LABEL[p.shape] || p.shape}</small>
                      </button>
                    </li>
                  ))}
                </ul>
                {list.length > shown.length && <p className="st-note">先頭300件を表示中(全{list.length}件)。名前で絞り込めます。</p>}
              </div>
            )}
            {tab === 'world' && (
              <div className="st-inspector">
                <label className="st-field"><span className="st-label">ワールド名</span>
                  <input className="text-input" value={doc.name} maxLength={80} onChange={(e) => actions.meta({ name: e.target.value }, 'wname')} /></label>
                <label className="st-field"><span className="st-label">説明</span>
                  <input className="text-input" value={doc.description} maxLength={300} onChange={(e) => actions.meta({ description: e.target.value }, 'wdesc')} /></label>
                <label className="st-field"><span className="st-label">最大人数(1〜64)</span>
                  <input className="text-input st-num" type="number" min="1" max="64" value={doc.players.max} onChange={(e) => actions.meta({ players: { max: e.target.value } }, 'wmax')} /></label>
                <label className="st-field"><span className="st-label">ゲームロジック</span>
                  <select className="text-input" value={doc.logic?.id || 'none'} onChange={(e) => {
                    const id = e.target.value;
                    actions.meta({ logic: id === 'none' ? null : { id, version: 1, params: getLogicDefaults(id) } }, 'wlogic');
                  }}>
                    <option value="none">なし</option>
                    {LOGICS.map((logic) => <option key={logic.id} value={logic.id}>{logic.name}</option>)}
                  </select>
                </label>
                {doc.logic && (() => {
                  const definition = getLogicDefinition(doc.logic.id);
                  if (!definition) return <p className="st-note err">未登録のロジックID: {doc.logic.id} (.tgw内の設定は保持されます)</p>;
                  return (
                    <div className="st-logic-config">
                      <strong>{definition.name}</strong>
                      <p className="st-note">{definition.description}</p>
                      {Object.entries(definition.parameters).map(([key, field]) => (
                        <label className="st-field" key={key}>
                          <span className="st-label">{field.label}</span>
                          <input className="text-input st-num" type="number" min={field.min} max={field.max} step={field.step || 1}
                            value={doc.logic?.params?.[key] ?? field.default}
                            onChange={(e) => {
                              const value = e.target.value === '' ? field.default : Number(e.target.value);
                              const params = { ...(doc.logic?.params || {}), [key]: Number.isFinite(value) ? value : field.default };
                              actions.meta({ logic: { ...doc.logic, version: 1, params } }, 'logic-param-' + key);
                            }} />
                          <span className="st-note">{field.description}</span>
                        </label>
                      ))}
                      <p className="st-note">利用できるパーツタグ: {definition.tags.map((tag) => tag.id).join(' / ')}</p>
                    </div>
                  );
                })()}
                <div className="st-row"><span className="st-label">スポーン {doc.spawns.length}個</span><span className="st-spacer" />
                  <button className="secondary-button" type="button" onClick={() => { const t = vpRef.current ? vpRef.current.getTarget() : [0, 0, 0]; actions.addSpawn([Math.round(t[0]), Math.round(t[1]) + 0.5, Math.round(t[2])]); }}>画面中央に追加</button>
                  <button className="secondary-button" type="button" disabled={!doc.spawns.length} onClick={() => actions.removeSpawn(doc.spawns.length - 1)}>最後を削除</button></div>
                {check.warnings.map((w) => <p key={w} className="st-note warn">⚠ {w}</p>)}
                {check.errors.map((w) => <p key={w} className="st-note err">✕ {w}</p>)}
                <hr className="panel-divider" />
                <button className="secondary-button" type="button" onClick={() => { if (window.confirm('現在のワールドを破棄して新規作成しますか?(元に戻せません)')) actions.newDoc(); }}>新規ワールド</button>
              </div>
            )}
          </div>
          <p className={`status-message st-status${st.message.kind ? ' ' + st.message.kind : ''}`} role="status" aria-live="polite">{st.message.text}</p>
        </aside>
      </div>
    </div>
  );
}

import { useCallback, useState } from 'react';
import { CONFIG } from '../config.js';
import AvatarStage from './AvatarStage.jsx';

function PartToggle({ part }) {
  const [on, setOn] = useState(part.object.visible !== false);
  return (
    <li>
      <label className="part-toggle">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            part.object.visible = e.target.checked; // Three.js側のオブジェクトを直接切り替える
            setOn(e.target.checked);
          }}
        />
        <span>{part.name}</span>
        {part.custom && <span className="tag ok">体</span>}
        {part.clothed && <span className="tag ok">服</span>}
        {part.accessory && <span className={`tag ${part.error ? 'error' : 'ok'}`}>{part.error ? '失敗' : 'アクセ'}</span>}
      </label>
    </li>
  );
}

export default function AvatarSection({ avatar }) {
  const { desc, status, busy, loadUser, loadDemo, demos } = avatar;
  const [input, setInput] = useState(() => CONFIG.lastUser);
  const [built, setBuilt] = useState(null);
  const [buildKey, setBuildKey] = useState(0);

  const handleBuilt = useCallback((b) => {
    setBuilt(b);
    setBuildKey((k) => k + 1); // 組み直すたびにチェックボックスの状態を作り直す
  }, []);

  function submit(e) {
    e.preventDefault();
    loadUser(input);
  }

  const parts = built ? built.parts : [];
  const accCount = parts.filter((p) => p.accessory).length;
  const report = desc.report || [];

  return (
    <section className="section-block" id="avatar-section">
      <div className="section-heading">
        <div>
          <h2>ユーザーを読み込む</h2>
          <p>ユーザー名またはユーザーIDから、パーツを組み立ててアバターを表示します。</p>
        </div>
      </div>

      <form className="avatar-form" onSubmit={submit}>
        <input
          className="text-input"
          placeholder="ユーザー名 または ユーザーID"
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? '読み込み中…' : '読み込む'}
        </button>
      </form>
      <div className="demo-row">
        {demos.map((d) => (
          <button key={d.id} type="button" className="secondary-button" onClick={() => loadDemo(d)}>
            {d.label}
          </button>
        ))}
      </div>
      <p className={`status-message${status.kind ? ' ' + status.kind : ''}`}>{status.text}</p>

      <div className="avatar-layout">
        <AvatarStage desc={desc} onBuilt={handleBuilt} />
        <div className="avatar-side">
          <div className="panel">
            <h3>
              パーツ <small>({desc.rigType} / {parts.length - accCount}パーツ{accCount ? ` + アクセ${accCount}` : ''})</small>
            </h3>
            <ul className="parts-list" key={buildKey}>
              {parts.map((p, i) => <PartToggle key={`${i}-${p.name}`} part={p} />)}
            </ul>
          </div>
          {built && built.diag && (
            <div className="panel">
              <h3>体パーツ診断</h3>
              <textarea className="text-input" readOnly rows={4} value={built.diag} onFocus={(e) => e.target.select()} />
              <button type="button" className="secondary-button" onClick={() => navigator.clipboard && navigator.clipboard.writeText(built.diag)}>
                コピー
              </button>
            </div>
          )}
          <div className="panel">
            <h3>アセット</h3>
            {report.length === 0 ? (
              <p className="panel-empty">デモアバターにはアセットがありません</p>
            ) : (
              <ul className="report-list">
                {report.map((r, i) => (
                  <li key={`${r.id}-${i}`} title={r.note}>
                    <span className="nm">{r.name}({r.type})</span>
                    <span className={`st ${r.status}`}>{r.status === 'ok' ? '適用' : r.note}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

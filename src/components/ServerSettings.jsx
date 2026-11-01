import { useRef, useState } from 'react';
import { CONFIG } from '../config.js';
import { addServer, deleteServer, describeError, getHealth } from '../servers/api.js';

const MAX_BYTES = 100 * 1024 * 1024;

export default function ServerSettings({ servers, onChanged }) {
  const [apiBase, setApiBase] = useState(CONFIG.apiBase);
  const [pass, setPass] = useState(CONFIG.adminPassphrase);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ text: '', kind: '' });
  const fileRef = useRef(null);

  function save() {
    CONFIG.apiBase = apiBase;
    CONFIG.adminPassphrase = pass;
    setApiBase(CONFIG.apiBase);
    setMsg({ text: '保存しました', kind: 'ok' });
    onChanged();
  }

  async function test() {
    CONFIG.apiBase = apiBase;
    setMsg({ text: 'テスト中…', kind: '' });
    try {
      const h = await getHealth();
      if (!h.db) setMsg({ text: 'Workerには繋がりましたが、D1が未初期化です。schema.sql を実行してください。', kind: 'error' });
      else if (!h.r2) setMsg({ text: 'R2のバインド(BUCKET)がありません。wrangler.toml を確認してください。', kind: 'error' });
      else setMsg({ text: `接続OK(登録 ${h.count} 件)/ 合言葉: ${h.hasAdmin ? '設定済み' : '未設定(ADMIN_PASSPHRASE を登録してください)'}`, kind: h.hasAdmin ? 'ok' : 'error' });
    } catch (e) {
      setMsg({ text: describeError(e), kind: 'error' });
    }
  }

  function pickFile(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const ext = f.name.split('.').pop().toLowerCase();
    if (ext !== 'tgw' && ext !== 'rbxl' && ext !== 'rbxlx') {
      setMsg({ text: '.tgw / .rbxl / .rbxlx を選んでください。', kind: 'error' });
      e.target.value = '';
      return;
    }
    if (f.size > MAX_BYTES) {
      setMsg({ text: 'ファイルが大きすぎます(上限100MB)。', kind: 'error' });
      e.target.value = '';
      return;
    }
    setFile(f);
    if (!name) setName(f.name.replace(/\.(tgw|rbxlx?)$/i, ''));
    setMsg({ text: '', kind: '' });
  }

  async function add() {
    if (!file || !name.trim()) {
      setMsg({ text: '名前とファイルを指定してください。', kind: 'error' });
      return;
    }
    setBusy(true);
    setMsg({ text: 'アップロード中…', kind: '' });
    try {
      await addServer({ name: name.trim(), description: description.trim(), file }, pass);
      setMsg({ text: `「${name.trim()}」を追加しました`, kind: 'ok' });
      setName(''); setDescription(''); setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      onChanged();
    } catch (e) {
      setMsg({ text: describeError(e), kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function remove(s) {
    if (!window.confirm(`「${s.name}」を削除しますか?(R2のファイルも消えます)`)) return;
    setBusy(true);
    try {
      await deleteServer(s.id, pass);
      setMsg({ text: `「${s.name}」を削除しました`, kind: 'ok' });
      onChanged();
    } catch (e) {
      setMsg({ text: describeError(e), kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section-block" id="settings-servers">
      <div className="section-heading">
        <div>
          <h2>サーバー管理</h2>
          <p>worker/index.js をデプロイしたURLと、管理用の合言葉を入力します。</p>
        </div>
      </div>
      <div className="panel">
        <label className="field-label" htmlFor="api-input">サーバーAPIのURL</label>
        <input id="api-input" className="text-input" placeholder="https://rbxl-player-api.xxxx.workers.dev"
          autoCapitalize="off" spellCheck={false} value={apiBase} onChange={(e) => setApiBase(e.target.value)} />
        <label className="field-label" htmlFor="pass-input">管理用の合言葉(追加・削除に必要)</label>
        <input id="pass-input" className="text-input" type="password" autoComplete="off"
          value={pass} onChange={(e) => setPass(e.target.value)} />
        <div className="button-row">
          <button className="primary-button" type="button" onClick={save}>保存</button>
          <button className="secondary-button" type="button" onClick={test}>接続テスト</button>
        </div>

        <hr className="panel-divider" />

        <label className="field-label" htmlFor="srv-name">サーバーを追加</label>
        <input id="srv-name" className="text-input" placeholder="名前" maxLength={80}
          value={name} onChange={(e) => setName(e.target.value)} />
        <input className="text-input" placeholder="説明(任意)" maxLength={300}
          value={description} onChange={(e) => setDescription(e.target.value)} />
        <input ref={fileRef} className="text-input" type="file" accept=".tgw,.rbxl,.rbxlx" onChange={pickFile} />
        <div className="button-row">
          <button className="primary-button" type="button" disabled={busy} onClick={add}>追加</button>
        </div>

        {servers.length > 0 && (
          <ul className="server-admin-list">
            {servers.map((s) => (
              <li key={s.id}>
                <span>{s.name}</span>
                <button className="secondary-button" type="button" disabled={busy} onClick={() => remove(s)}>削除</button>
              </li>
            ))}
          </ul>
        )}
        <p className={`status-message${msg.kind ? ' ' + msg.kind : ''}`}>{msg.text}</p>
      </div>
    </section>
  );
}

import { useState } from 'react';
import { CONFIG } from '../config.js';

export default function SettingsSection() {
  const [proxy, setProxy] = useState(CONFIG.proxyBase);
  const [pixelRatio, setPixelRatio] = useState(String(CONFIG.pixelRatioCap));
  const [msg, setMsg] = useState({ text: '', kind: '' });

  function save() {
    CONFIG.proxyBase = proxy;
    setProxy(CONFIG.proxyBase);
    setMsg({ text: '保存しました', kind: 'ok' });
  }

  async function test() {
    CONFIG.proxyBase = proxy;
    const base = CONFIG.proxyBase.replace(/\/+$/, '');
    if (!base) {
      setMsg({ text: 'プロキシURLを入力してください', kind: 'error' });
      return;
    }
    setMsg({ text: 'テスト中…', kind: '' });
    try {
      // 1) Workerのバージョンと、APIキーが設定されているか(値は返ってこない)
      const h = await fetch(`${base}/health`);
      const health = h.ok ? await h.json().catch(() => null) : null;
      if (!health || !health.ok) {
        setMsg({ text: 'Workerに接続できないか、古いバージョンです。最新の worker/proxy.js を再デプロイしてください。', kind: 'error' });
        return;
      }
      // 2) ユーザー情報など公開APIの中継
      const r = await fetch(`${base}/?url=${encodeURIComponent('https://users.roblox.com/v1/users/1')}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setMsg(health.hasApiKey
        ? { text: `接続OK(ユーザーID 1: ${j.name || '?'})/ APIキー: 設定済み`, kind: 'ok' }
        : { text: `接続OK(ユーザーID 1: ${j.name || '?'})ですが、APIキーが未設定のためアセット(服・アクセサリ)は取得できません。README の手順で ROBLOX_API_KEY を設定してください。`, kind: 'error' });
    } catch (e) {
      setMsg({ text: '接続に失敗しました。URLとWorkerのデプロイを確認してください。', kind: 'error' });
    }
  }

  function changePixelRatio(e) {
    setPixelRatio(e.target.value);
    CONFIG.pixelRatioCap = e.target.value; // 次にアバター画面を開いたときから反映
  }

  return (
    <>
      <section className="section-block" id="settings-proxy">
        <div className="section-heading">
          <div>
            <h2>Robloxプロキシ</h2>
            <p>ユーザー読み込みに必要です。worker/proxy.js をCloudflare WorkersにデプロイしたURLを入力します。</p>
          </div>
        </div>
        <div className="panel">
          <label className="field-label" htmlFor="proxy-input">プロキシURL</label>
          <input
            id="proxy-input"
            className="text-input"
            placeholder="https://rbxl-player-proxy.xxxx.workers.dev"
            autoCapitalize="off"
            spellCheck={false}
            value={proxy}
            onChange={(e) => setProxy(e.target.value)}
          />
          <div className="button-row">
            <button className="primary-button" type="button" onClick={save}>保存</button>
            <button className="secondary-button" type="button" onClick={test}>接続テスト</button>
          </div>
          <p className={`status-message${msg.kind ? ' ' + msg.kind : ''}`}>{msg.text}</p>
        </div>
      </section>

      <section className="section-block" id="settings-render">
        <div className="section-heading">
          <div>
            <h2>描画</h2>
            <p>スマホで重いときは解像度の上限を下げてください。</p>
          </div>
        </div>
        <div className="panel">
          <label className="field-label" htmlFor="pr-select">解像度の上限(PixelRatio)</label>
          <select id="pr-select" className="text-input" value={pixelRatio} onChange={changePixelRatio}>
            <option value="1">1(軽い)</option>
            <option value="1.5">1.5</option>
            <option value="2">2(標準)</option>
            <option value="3">3(高画質)</option>
          </select>
        </div>
      </section>
    </>
  );
}

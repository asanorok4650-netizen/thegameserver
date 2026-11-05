// アプリ設定(localStorageに保存。使えない環境でも落ちないようにする)
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 無視 */ } };

// 標準のエンドポイント(公開されるURLで、秘密ではない。守りはWorker側のALLOWED_ORIGIN・レート制限・転送先の限定)。
// 管理用の合言葉やAPIキーは、ここに書かない。
export const DEFAULTS = {
  apiBase: 'https://rbxl-player-api.konoyo9641.workers.dev',
  proxyBase: 'https://rbxl-player-proxy.konoyo9641.workers.dev'
};
const env = (k) => (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[k]) || '';
// 優先順: 設定画面で入れた値(空欄は未設定扱い) > ビルド時の環境変数 > 標準のURL
const pick = (key, envKey, fallback) => lsGet(key, '').trim() || String(env(envKey)).trim() || fallback;

export const CONFIG = {
  // サーバー一覧API(worker/index.js のURL)
  get apiBase() { return pick('rbxl.apiBase', 'VITE_API_BASE', DEFAULTS.apiBase); },
  set apiBase(v) { lsSet('rbxl.apiBase', String(v || '').trim()); },
  // 設定画面で上書きした値だけ(空なら標準のURLを使っている)
  get apiBaseOverride() { return lsGet('rbxl.apiBase', '').trim(); },
  // 管理用の合言葉(このブラウザにだけ保存。空にすると消えます)
  get adminPassphrase() { return lsGet('rbxl.adminPassphrase', ''); },
  set adminPassphrase(v) { lsSet('rbxl.adminPassphrase', String(v || '')); },
  // Roblox APIへのCORSプロキシ(proxycode の worker/proxy.js をデプロイしたURL)
  get proxyBase() { return pick('rbxl.proxyBase', 'VITE_PROXY_BASE', DEFAULTS.proxyBase); },
  set proxyBase(v) { lsSet('rbxl.proxyBase', String(v || '').trim()); },
  get proxyBaseOverride() { return lsGet('rbxl.proxyBase', '').trim(); },
  // 描画解像度の上限(スマホ向けに設定画面から変更可能)
  get pixelRatioCap() { return Number(lsGet('rbxl.pixelRatioCap', '2')) || 2; },
  set pixelRatioCap(v) { lsSet('rbxl.pixelRatioCap', String(v)); },
  get lastUser() { return lsGet('rbxl.lastUser', ''); },
  set lastUser(v) { lsSet('rbxl.lastUser', String(v || '')); },
};

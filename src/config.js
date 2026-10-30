// アプリ設定(localStorageに保存。使えない環境でも落ちないようにする)
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 無視 */ } };

export const CONFIG = {
  // Roblox APIへのCORSプロキシ(worker/proxy.js をデプロイしたURL)
  get proxyBase() { return lsGet('rbxl.proxyBase', ''); },
  set proxyBase(v) { lsSet('rbxl.proxyBase', String(v || '').trim()); },
  // 描画解像度の上限(スマホ向けに設定画面から変更可能)
  get pixelRatioCap() { return Number(lsGet('rbxl.pixelRatioCap', '2')) || 2; },
  set pixelRatioCap(v) { lsSet('rbxl.pixelRatioCap', String(v)); },
  get lastUser() { return lsGet('rbxl.lastUser', ''); },
  set lastUser(v) { lsSet('rbxl.lastUser', String(v || '')); },
};

// Studioの入出力。サーバーに通信するのは publishDoc だけ(保存=ローカル、書き出し=ファイル)。
import { docToPackage, docFromPackage, checkDoc } from './model.js';
import { addServer, deleteServer } from '../servers/api.js';
import { loadWorldPackage } from '../game/loader.js';

/** .tgw のバイト列を作る(fflate は使う時だけ読み込む) */
export async function buildDocTgw(doc, extra = {}) {
  const { buildTgw } = await import('../tgw/container.js');
  const { manifest, worldJson } = docToPackage(doc, extra);
  return buildTgw({ manifest, worldJson });
}

const safeName = (s) => (s || 'world').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'world';

/** ブラウザのダウンロードとして書き出す(通信なし) */
export async function downloadTgw(doc) {
  const bytes = await buildDocTgw(doc);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url; a.download = safeName(doc.name) + '.tgw';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return bytes.length;
}

/** .tgw / .rbxl のFileを開いてドキュメントにする(通信なし) */
export async function openFile(file, log = () => {}) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pkg = await loadWorldPackage(bytes, log);
  const doc = docFromPackage(pkg, file.name.replace(/\.(tgw|rbxlx?)$/i, ''));
  if (pkg.format === 'rbxl' && doc.source) doc.source = { ...doc.source, kind: 'rbxl', name: file.name };
  return { doc, warnings: pkg.warnings || [] };
}

/**
 * 公開(サーバーへのリクエストはここだけ)。
 * 現在のAPIには上書きがないため、「新規追加 → 成功したら以前の公開を削除」で置き換える。
 * 追加に失敗したら以前の公開は消さない。@returns { id, replaced }
 */
export async function publishDoc(doc, passphrase, { replace = true } = {}) {
  const { errors } = checkDoc(doc);
  if (errors.length) throw new Error(errors.join(' / '));
  const bytes = await buildDocTgw(doc);
  const file = new File([bytes], safeName(doc.name) + '.tgw', { type: 'application/zip' });
  const res = await addServer({ name: doc.name.trim(), description: doc.description, file }, passphrase);
  const id = (res && (res.id || (res.server && res.server.id))) || null;
  let replaced = false;
  if (replace && doc.publishedId && id && doc.publishedId !== id) {
    try { await deleteServer(doc.publishedId, passphrase); replaced = true; } catch { /* 古い公開が残るだけ。新しい公開は成功している */ }
  }
  return { id, replaced, size: bytes.length };
}

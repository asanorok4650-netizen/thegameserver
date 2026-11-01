// R2のrbxlを取得して解析する(THREE非依存)
import { parseRbxm, isBinaryRbxm } from '../rbx/rbxm.js';

/** 進捗つきでダウンロード。total はサーバー一覧のサイズ(Content-Lengthは使えないため) */
export async function fetchRbxl(url, total, onProgress, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`ダウンロードに失敗しました(HTTP ${res.status})`);
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export function parseRbxl(bytes) {
  if (!isBinaryRbxm(bytes)) {
    const head = new TextDecoder().decode(bytes.subarray(0, 40));
    if (/^<roblox/i.test(head)) throw new Error('XML形式(rbxlx)はまだ読み込めません。Studioで「.rbxl」として保存し直してください。');
    throw new Error('rbxlとして読み込めませんでした(ファイルが壊れているか、形式が違います)。');
  }
  return parseRbxm(bytes);
}

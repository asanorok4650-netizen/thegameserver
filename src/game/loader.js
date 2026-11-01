// R2のサーバーファイル(.rbxl / .tgw)を取得して world.json にする(THREE非依存)
import { parseRbxm, isBinaryRbxm } from '../rbx/rbxm.js';
import { treeToWorldJson } from '../tgw/worldjson.js';
import { hasZipMagic } from '../tgw/validate.js';
import { resolveLogicConfig } from '../logics/index.js';

/** 進捗つきでダウンロード。total はサーバー一覧のサイズ(Content-Lengthは使えないため) */
export async function fetchServerFile(url, total, onProgress, signal) {
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
export const fetchRbxl = fetchServerFile; // 従来名

export function parseRbxl(bytes) {
  if (!isBinaryRbxm(bytes)) {
    const head = new TextDecoder().decode(bytes.subarray(0, 40));
    if (/^<roblox/i.test(head)) throw new Error('XML形式(rbxlx)はまだ読み込めません。Studioで「.rbxl」として保存し直してください。');
    throw new Error('rbxlとして読み込めませんでした(ファイルが壊れているか、形式が違います)。');
  }
  return parseRbxm(bytes);
}

/** 拡張子やD1の format ではなく、先頭のバイト列で判別する(仕様§2) */
export function detectFormat(bytes) {
  if (hasZipMagic(bytes)) return 'tgw';
  return 'rbxl'; // 以降の parseRbxl が rbxlx / 不明な形式のエラーを出す
}

/**
 * ダウンロードしたバイト列 → ワールド。以降(シーン構築・衝突)は形式によらず共通。
 * @returns { format, worldJson, manifest|null, report:{ approx, ignored, spawnFound }, warnings:[string], info:string }
 */
export async function loadWorldPackage(bytes, log = () => {}) {
  const format = detectFormat(bytes);
  if (format === 'tgw') {
    const { readTgw } = await import('../tgw/container.js'); // fflate は .tgw のときだけ読み込む
    const { manifest, worldJson } = readTgw(bytes);
    const src = manifest.source || {};
    return {
      format, worldJson, manifest, logic: resolveLogicConfig(manifest.logic), warnings: [],
      report: { approx: src.approx || {}, ignored: src.ignored || {}, spawnFound: (worldJson.spawns || []).length > 0 },
      info: `.tgw「${manifest.name}」 パーツ ${worldJson.parts.length}個`
    };
  }
  const tree = parseRbxl(bytes);
  const { worldJson, report } = treeToWorldJson(tree, log);
  return { format, worldJson, manifest: null, logic: resolveLogicConfig(null), report, warnings: tree.warnings, info: `rbxl インスタンス ${tree.instances.size}個` };
}

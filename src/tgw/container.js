// .tgw(ZIPコンテナ)の読み書き。ブラウザ/Studio用(fflate)。Workerはここを使わない(展開せずR2に置くだけ)。
// 仕様: tgw-spec-v0.1 §2 §7 §8
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { hasZipMagic, validateEntries, validateManifest, validateWorld } from './validate.js';

export { hasZipMagic };

const dec = new TextDecoder('utf-8', { fatal: true });

function parseJson(bytes, what) {
  try { return JSON.parse(dec.decode(bytes)); }
  catch { throw new Error(`.tgw: ${what} をJSONとして読めませんでした`); }
}

/** ZIPのエントリ一覧だけ取り出す(中身は展開しない) */
function listEntries(bytes) {
  const entries = [];
  unzipSync(bytes, { filter: (f) => { entries.push({ name: f.name, size: f.originalSize }); return false; } });
  return entries;
}

/** 指定した名前のエントリだけ展開する。宣言サイズと実サイズが違えば拒否(zip bomb対策) */
function extract(bytes, declared, names) {
  const want = new Set(names);
  const out = unzipSync(bytes, { filter: (f) => want.has(f.name) });
  for (const n of names) {
    if (!out[n]) continue;
    if (out[n].length !== declared.get(n)) throw new Error(`.tgw: ${n} のサイズがZIPの宣言と一致しません`);
  }
  return out;
}

/**
 * .tgw を読んで検証する。展開するのは manifest.json と world.json だけ(assets等は readEntry で必要になった時に読む)。
 * @returns { manifest, worldJson, entries:[{name,size}] }
 */
export function readTgw(bytes) {
  if (!hasZipMagic(bytes)) throw new Error('.tgw: ZIP形式ではありません(先頭のバイト列が違います)');
  let entries;
  try { entries = listEntries(bytes); }
  catch (e) { throw new Error('.tgw: ZIPを読めませんでした(' + (e && e.message ? e.message : e) + ')'); }
  validateEntries(entries);
  const declared = new Map(entries.map((e) => [e.name, e.size]));

  const mOut = extract(bytes, declared, ['manifest.json']);
  const manifest = validateManifest(parseJson(mOut['manifest.json'], 'manifest.json'));
  const worldFile = manifest.world.file;
  if (!declared.has(worldFile)) throw new Error(`.tgw: ${worldFile} がありません`);
  const wOut = extract(bytes, declared, [worldFile]);
  const worldJson = validateWorld(parseJson(wOut[worldFile], worldFile), manifest);
  return { manifest, worldJson, entries };
}

/** assets/ などを1つだけ展開する(entries は readTgw の戻り値) */
export function readEntry(bytes, entries, name) {
  const declared = new Map(entries.map((e) => [e.name, e.size]));
  if (!declared.has(name)) throw new Error(`.tgw: ${name} がありません`);
  return extract(bytes, declared, [name])[name];
}

// 圧縮済みの形式は無圧縮(store)で格納して二重圧縮を避ける
const STORE_EXT = /\.(png|jpe?g|webp|gif|ogg|mp3|m4a|mp4|webm|zip|drc|glb)$/i;

/**
 * .tgw を作る(Studio用)。files は { 'assets/a.png': Uint8Array } のように渡す。
 * manifest.json / world.json はテキストなのでdeflate(レベル9)、画像などはstore。
 */
export function buildTgw({ manifest, worldJson, files = {} }) {
  const entries = {
    'manifest.json': [strToU8(JSON.stringify(manifest, null, 2)), { level: 9 }],
    [manifest.world.file]: [strToU8(JSON.stringify(worldJson)), { level: 9 }]
  };
  for (const [name, data] of Object.entries(files)) {
    entries[name] = [data, { level: STORE_EXT.test(name) ? 0 : 6 }];
  }
  const out = zipSync(entries);
  validateEntries(Object.entries(entries).map(([name, v]) => ({ name, size: v[0].length })));
  return out;
}

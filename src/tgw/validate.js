// .tgw の検証(ZIPライブラリ非依存の純関数)。Studioのアップロード前と、クライアント/ルーム起動時の読み込みで使う。
// 仕様: tgw-spec-v0.1 §3 §4 §8

export const SUPPORTED_MAJOR = 1;
export const LIMITS = { maxEntries: 2000, maxTotalUnpacked: 300 * 1024 * 1024, maxPackedBytes: 100 * 1024 * 1024 };
export const SHAPES = new Set(['block', 'ball', 'cylinder', 'wedge', 'corner']);

const fail = (msg) => { throw new Error('.tgw: ' + msg); };
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const numArr = (a, n) => Array.isArray(a) && a.length === n && a.every(finite);

/** 先頭がZIPのローカルヘッダか(拡張子ではなくマジックバイトで判別) */
export function hasZipMagic(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** 相対パスのみ許可。'..'・絶対パス・バックスラッシュ・ドライブ文字・NULを拒否 */
export function checkEntryPath(name) {
  if (typeof name !== 'string' || !name) fail('空のパスがあります');
  if (name.includes('\\')) fail(`バックスラッシュを含むパスは使えません: ${name}`);
  if (name.includes('\0')) fail('不正なパスがあります');
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) fail(`絶対パスは使えません: ${name}`);
  if (name.split('/').some((seg) => seg === '..')) fail(`".." を含むパスは使えません: ${name}`);
}

/** @param entries [{ name, size }] size=ZIPに宣言された展開後サイズ */
export function validateEntries(entries) {
  if (entries.length > LIMITS.maxEntries) fail(`エントリ数が多すぎます(上限${LIMITS.maxEntries})`);
  let total = 0;
  const seen = new Set();
  for (const e of entries) {
    checkEntryPath(e.name);
    if (seen.has(e.name)) fail(`同名のエントリが重複しています: ${e.name}`);
    seen.add(e.name);
    if (!finite(e.size) || e.size < 0) fail(`サイズが不正です: ${e.name}`);
    total += e.size;
    if (total > LIMITS.maxTotalUnpacked) fail(`展開後の合計サイズが大きすぎます(上限${LIMITS.maxTotalUnpacked / 1048576}MB)`);
  }
  if (!seen.has('manifest.json')) fail('manifest.json がありません');
  return true;
}

/** "1.0" のメジャーを取り出す。メジャー違いは拒否、マイナーは無視して読む */
export function checkFormatVersion(v, what) {
  const m = typeof v === 'string' && /^(\d+)\.(\d+)$/.exec(v);
  if (!m) fail(`${what}.formatVersion が不正です`);
  if (Number(m[1]) !== SUPPORTED_MAJOR) fail(`${what} のバージョン ${v} には対応していません(対応: ${SUPPORTED_MAJOR}.x)`);
}

export function validateManifest(m) {
  if (!m || typeof m !== 'object') fail('manifest.json がオブジェクトではありません');
  checkFormatVersion(m.formatVersion, 'manifest');
  if (typeof m.name !== 'string' || !m.name.trim()) fail('manifest.name がありません');
  const players = m.players || {};
  if (players.max !== undefined && !(Number.isInteger(players.max) && players.max >= 1 && players.max <= 64)) fail('manifest.players.max は1〜64の整数にしてください');
  if (players.sendHz !== undefined && !(finite(players.sendHz) && players.sendHz > 0 && players.sendHz <= 60)) fail('manifest.players.sendHz は0より大きく60以下にしてください');
  const w = m.world;
  if (!w || typeof w.file !== 'string') fail('manifest.world.file がありません');
  checkEntryPath(w.file);
  if (w.partCount !== undefined && !(Number.isInteger(w.partCount) && w.partCount >= 0)) fail('manifest.world.partCount が不正です');
  if (m.logic !== undefined) {
    if (!m.logic || typeof m.logic.id !== 'string' || !m.logic.id) fail('manifest.logic.id がありません');
    if (m.logic.version !== undefined && !Number.isInteger(m.logic.version)) fail('manifest.logic.version は整数にしてください');
    if (m.logic.params !== undefined && (typeof m.logic.params !== 'object' || m.logic.params === null || Array.isArray(m.logic.params))) fail('manifest.logic.params はオブジェクトにしてください');
  }
  if (m.rules !== undefined && (typeof m.rules !== 'object' || m.rules === null || Array.isArray(m.rules))) fail('manifest.rules はオブジェクトにしてください');
  if (m.thumbnail !== undefined) { if (typeof m.thumbnail !== 'string') fail('manifest.thumbnail が不正です'); checkEntryPath(m.thumbnail); }
  return m;
}

/** manifest と突き合わせて world.json を検証(parts.length === partCount、数値は有限) */
export function validateWorld(w, manifest) {
  if (!w || typeof w !== 'object') fail('world.json がオブジェクトではありません');
  checkFormatVersion(w.formatVersion, 'world');
  if (w.units !== undefined && w.units !== 'studs') fail(`world.units "${w.units}" には対応していません`);
  if (w.up !== undefined && w.up !== '+Y') fail(`world.up "${w.up}" には対応していません`);
  if (!Array.isArray(w.parts)) fail('world.parts がありません');
  if (manifest && manifest.world && manifest.world.partCount !== undefined && manifest.world.partCount !== w.parts.length) {
    fail(`パーツ数が一致しません(manifest ${manifest.world.partCount} / world.json ${w.parts.length})`);
  }
  const ids = new Set();
  w.parts.forEach((p, i) => {
    const at = `parts[${i}]`;
    if (!p || typeof p !== 'object') fail(`${at} が不正です`);
    if (typeof p.id !== 'string' || !p.id) fail(`${at}.id がありません`);
    if (ids.has(p.id)) fail(`${at}.id が重複しています: ${p.id}`);
    ids.add(p.id);
    if (!SHAPES.has(p.shape)) fail(`${at}.shape が不正です: ${p.shape}`);
    if (!numArr(p.size, 3) || !p.size.every((v) => v > 0)) fail(`${at}.size は正の数3つにしてください`);
    if (!numArr(p.pos, 3)) fail(`${at}.pos は数値3つにしてください`);
    if (!numArr(p.rot, 9)) fail(`${at}.rot は数値9つにしてください`);
    if (typeof p.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(p.color)) fail(`${at}.color は #rrggbb にしてください`);
    if (!finite(p.transparency) || p.transparency < 0 || p.transparency > 1) fail(`${at}.transparency は0〜1にしてください`);
    if (typeof p.collide !== 'boolean') fail(`${at}.collide は true/false にしてください`);
    if (p.tags !== undefined && !(Array.isArray(p.tags) && p.tags.every((t) => typeof t === 'string'))) fail(`${at}.tags は文字列の配列にしてください`);
    if (p.attrs !== undefined && (typeof p.attrs !== 'object' || p.attrs === null || Array.isArray(p.attrs))) fail(`${at}.attrs はオブジェクトにしてください`);
  });
  if (w.environment !== undefined && (typeof w.environment !== 'object' || w.environment === null || Array.isArray(w.environment))) fail('world.environment はオブジェクトにしてください');
  const spawns = w.spawns === undefined ? [] : w.spawns;
  if (!Array.isArray(spawns)) fail('world.spawns が不正です');
  spawns.forEach((s, i) => {
    if (!s || !numArr(s.pos, 3) || !numArr(s.size, 3)) fail(`spawns[${i}] は pos/size が数値3つの形にしてください`);
  });
  return w;
}

// Studioのドキュメントモデル(THREE・DOM非依存の純関数。テストはNodeで動く)
// ドキュメントは不変(immutable)に扱い、更新のたびに新しいオブジェクトを返す。
// → 履歴(undo/redo)は「過去のdocへの参照」を持つだけでよく、パーツ数が多くても軽い。
import { WORLD_FORMAT_VERSION, worldBounds } from '../tgw/worldjson.js';
import { createManifest } from '../tgw/manifest.js';
import { SHAPES } from '../tgw/validate.js';
import { RULE_FIELDS, ENV_FIELDS, resolveRules, resolveEnvironment, diffFromDefault } from '../game/rules.js';
import { resolveBehavior, setBehavior } from '../behaviors/index.js';

export const IDENT = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]);

/** Studioが管理するロジック(manifest.logic)の既定。ロジック定義は後で logics.js に切り出す */
export const DEFAULT_LOGIC = { id: 'none', version: 1, params: {} };

export function createDoc(opts = {}) {
  const base = {
    name: opts.name || 'Untitled World',
    description: opts.description || '',
    players: { max: 8, sendHz: 10, ...(opts.players || {}) },
    logic: opts.logic || null,
    rules: resolveRules(opts.rules),             // 物理(歩く速さ・ジャンプ力・重力)。常に検証済みの全項目
    environment: resolveEnvironment(opts.environment), // 空・光・霧
    spawns: opts.spawns || [],
    parts: opts.parts || [],
    nextId: 1,
    source: opts.source || null, // 取り込み元(rbxl変換時の ignored/approx)。manifest.source にそのまま戻す
    publishedId: opts.publishedId || null
  };
  base.nextId = nextIdFor(base.parts);
  return base;
}

/**
 * 保存済みの下書き(古い版で作られたもの含む)を、いまのドキュメント形式に整える。
 * 新しく増えた項目(rules / environment など)が無くても落ちないようにする。入力は書き換えない。
 */
export function normalizeDoc(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const parts = Array.isArray(d.parts) ? d.parts.map((p) => clonePart(p)) : [];
  const base = createDoc({
    name: typeof d.name === 'string' ? d.name : undefined,
    description: typeof d.description === 'string' ? d.description : '',
    players: d.players,
    logic: d.logic || null,
    rules: d.rules,
    environment: d.environment,
    spawns: Array.isArray(d.spawns) ? d.spawns.map((s) => ({ pos: s.pos.slice(), size: s.size.slice() })) : [],
    parts,
    source: d.source || null,
    publishedId: d.publishedId || null
  });
  if (Number.isInteger(d.nextId) && d.nextId > base.nextId) base.nextId = d.nextId;
  return base;
}

/** 空のワールド: 地面1枚 + スポーン1つ(開いてすぐ形になるように) */
export function createStarterDoc(name = 'Untitled World') {
  let d = createDoc({ name });
  d = addPart(d, { name: 'Baseplate', size: [128, 1, 128], pos: [0, -0.5, 0], color: '#6b8e4e' }).doc;
  return addSpawn(d, { pos: [0, 0.5, 0], size: [6, 1, 6] });
}

/** loadWorldPackage の戻り値(または { worldJson, manifest, report })からドキュメントを作る */
export function docFromPackage(pkg, fallbackName = 'Imported World') {
  const m = pkg.manifest || {};
  const w = pkg.worldJson;
  return createDoc({
    name: m.name || fallbackName,
    description: m.description || '',
    players: m.players,
    logic: m.logic || null,
    rules: m.rules,
    environment: w.environment,
    spawns: (w.spawns || []).map((s) => ({ pos: s.pos.slice(), size: s.size.slice() })),
    parts: w.parts.map(clonePart),
    source: m.source || (pkg.report ? { kind: pkg.format || 'rbxl', name: '', ignored: pkg.report.ignored || {}, approx: pkg.report.approx || {} } : null)
  });
}

/** ドキュメント → { worldJson, manifest }(buildTgw にそのまま渡せる) */
export function docToPackage(doc, extra = {}) {
  const worldJson = {
    formatVersion: WORLD_FORMAT_VERSION, units: 'studs', up: '+Y',
    spawns: doc.spawns.map((s) => ({ pos: s.pos.slice(), size: s.size.slice() })),
    parts: doc.parts.map(clonePart)
  };
  const env = diffFromDefault(resolveEnvironment(doc.environment), ENV_FIELDS);
  if (env) worldJson.environment = env; // 既定値のままなら書かない
  const manifest = createManifest(worldJson, null, {
    name: doc.name, description: doc.description, author: extra.author || '',
    generator: 'thegameserver-studio', players: doc.players, logic: doc.logic || undefined, rules: diffFromDefault(resolveRules(doc.rules), RULE_FIELDS) || undefined
  });
  if (doc.source) manifest.source = doc.source;
  return { worldJson, manifest };
}

const clonePart = (p) => ({ ...p, size: p.size.slice(), pos: p.pos.slice(), rot: p.rot.slice(), tags: (p.tags || []).slice(), attrs: { ...(p.attrs || {}) } });

function nextIdFor(parts) {
  let max = 0;
  for (const p of parts) { const m = /^p(\d+)$/.exec(p.id); if (m) max = Math.max(max, Number(m[1])); }
  return max + 1;
}

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** 新しいパーツを作る(idは doc.nextId から採番)。@returns { doc, id } */
export function addPart(doc, init = {}) {
  const id = 'p' + doc.nextId;
  const size = (init.size || [4, 1, 2]).map((v) => Math.max(0.05, num(v, 1)));
  const part = {
    id,
    name: init.name || 'Part',
    shape: SHAPES.has(init.shape) ? init.shape : 'block',
    size,
    pos: (init.pos || [0, size[1] / 2, 0]).map((v) => num(v, 0)),
    rot: (init.rot || IDENT).slice(0, 9),
    color: /^#[0-9a-fA-F]{6}$/.test(init.color || '') ? init.color.toLowerCase() : '#a3a2a5',
    transparency: Math.min(1, Math.max(0, num(init.transparency, 0))),
    collide: init.collide !== false,
    tags: (init.tags || []).slice(),
    attrs: { ...(init.attrs || {}) }
  };
  return { doc: { ...doc, parts: [...doc.parts, part], nextId: doc.nextId + 1 }, id };
}

/** 値の正規化(不正値は無視して元の値を残す)。Studioの入力欄から直接渡せる */
function sanitize(patch, old) {
  const out = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'name') out.name = String(v).slice(0, 100);
    else if (k === 'shape') { if (SHAPES.has(v)) out.shape = v; }
    else if (k === 'size') { if (Array.isArray(v) && v.length === 3) out.size = v.map((x, i) => { const n = num(x, old.size[i]); return n > 0 ? n : old.size[i]; }); }
    else if (k === 'pos') { if (Array.isArray(v) && v.length === 3) out.pos = v.map((x, i) => num(x, old.pos[i])); }
    else if (k === 'rot') { if (Array.isArray(v) && v.length === 9 && v.every((x) => Number.isFinite(x))) out.rot = v.slice(); }
    else if (k === 'color') { if (/^#[0-9a-fA-F]{6}$/.test(v)) out.color = v.toLowerCase(); }
    else if (k === 'transparency') out.transparency = Math.min(1, Math.max(0, num(v, old.transparency)));
    else if (k === 'collide') out.collide = !!v;
    else if (k === 'tags') { if (Array.isArray(v)) out.tags = v.filter((t) => typeof t === 'string' && t); }
    else if (k === 'attrs') { if (v && typeof v === 'object' && !Array.isArray(v)) out.attrs = { ...v }; }
  }
  return out;
}

/** 複数パーツを更新。patch は { color:'#ff0000' } のような一部だけでよい。ids は配列 */
export function updateParts(doc, ids, patch) {
  const set = new Set(ids);
  let changed = false;
  const parts = doc.parts.map((p) => {
    if (!set.has(p.id)) return p;
    const next = sanitize(patch, p);
    if (!Object.keys(next).length) return p;
    changed = true;
    return { ...p, ...next };
  });
  return changed ? { ...doc, parts } : doc;
}

/** 選択パーツを (dx,dy,dz) だけ動かす */
export function movePartsBy(doc, ids, d) {
  const set = new Set(ids);
  return { ...doc, parts: doc.parts.map((p) => (set.has(p.id) ? { ...p, pos: [p.pos[0] + d[0], p.pos[1] + d[1], p.pos[2] + d[2]] } : p)) };
}

export function removeParts(doc, ids) {
  const set = new Set(ids);
  if (!doc.parts.some((p) => set.has(p.id))) return doc;
  return { ...doc, parts: doc.parts.filter((p) => !set.has(p.id)) };
}

/** 複製。少しずらして置く。@returns { doc, ids:[新しいid] } */
export function duplicateParts(doc, ids, offset = [2, 0, 2]) {
  const set = new Set(ids);
  let d = doc;
  const newIds = [];
  for (const p of doc.parts) {
    if (!set.has(p.id)) continue;
    const r = addPart(d, { ...p, pos: [p.pos[0] + offset[0], p.pos[1] + offset[1], p.pos[2] + offset[2]], name: p.name });
    d = r.doc; newIds.push(r.id);
  }
  return { doc: d, ids: newIds };
}

// ---- 物理ルール・環境(数値だけ。範囲外は丸め、不正値は無視) ----
export function setRules(doc, patch) {
  return { ...doc, rules: resolveRules({ ...resolveRules(doc.rules), ...patch }) };
}
export function setEnvironment(doc, patch) {
  return { ...doc, environment: resolveEnvironment({ ...resolveEnvironment(doc.environment), ...patch }) };
}

// ---- パーツの振る舞い(attrs.behavior とそのパラメータ) ----
/** 選んだパーツ全部の振る舞いを切り替える。id が空なら外す */
export function setPartBehavior(doc, ids, id) {
  const set = new Set(ids);
  return { ...doc, parts: doc.parts.map((p) => (set.has(p.id) ? { ...p, attrs: setBehavior(p.attrs, id) } : p)) };
}
/** 振る舞いのパラメータを1つ変える(範囲は resolveBehavior が表示・実行の両方で丸める) */
export function setPartBehaviorParam(doc, id, key, value) {
  return { ...doc, parts: doc.parts.map((p) => (p.id === id && resolveBehavior(p.attrs) ? { ...p, attrs: { ...p.attrs, [key]: value } } : p)) };
}

// ---- スポーン ----
export function addSpawn(doc, s) {
  return { ...doc, spawns: [...doc.spawns, { pos: s.pos.slice(), size: (s.size || [6, 1, 6]).slice() }] };
}
export function removeSpawn(doc, index) {
  return { ...doc, spawns: doc.spawns.filter((_, i) => i !== index) };
}

// ---- メタ情報 ----
export function setMeta(doc, patch) {
  const next = { ...doc };
  if (typeof patch.name === 'string') next.name = patch.name.slice(0, 80);
  if (typeof patch.description === 'string') next.description = patch.description.slice(0, 300);
  if (patch.players) {
    const max = Number(patch.players.max), hz = Number(patch.players.sendHz);
    next.players = { ...doc.players };
    if (Number.isInteger(max) && max >= 1 && max <= 64) next.players.max = max;
    if (Number.isFinite(hz) && hz > 0 && hz <= 60) next.players.sendHz = hz;
  }
  if (patch.logic !== undefined) next.logic = patch.logic;
  if (patch.publishedId !== undefined) next.publishedId = patch.publishedId;
  return next;
}

/** 公開前の確認(エラー=公開不可 / 警告=公開は可能) */
export function checkDoc(doc) {
  const errors = [], warnings = [];
  if (!doc.name.trim()) errors.push('ワールド名を入力してください');
  if (!doc.parts.length) errors.push('パーツがありません');
  if (!doc.spawns.length) warnings.push('スポーンがありません(原点付近から開始します)');
  if (doc.parts.length > 50000) warnings.push('パーツが5万個を超えています。読み込みが重くなる場合があります');
  const ignored = doc.source && doc.source.ignored;
  if (ignored) for (const [k, v] of Object.entries(ignored)) warnings.push(`${k} ${v}件は変換時に取り込まれていません`);
  return { errors, warnings };
}

export const docBounds = (doc) => worldBounds({ parts: doc.parts });

// ---- 回転ヘルパー(Studioの入力欄はY軸の角度だけ扱う。複合回転は「リセット」まで触らない) ----
/** Y軸まわりだけの回転ならその角度(度)、そうでなければ null */
export function yawOf(rot) {
  const eps = 1e-4;
  if (Math.abs(rot[1]) > eps || Math.abs(rot[3]) > eps || Math.abs(rot[5]) > eps || Math.abs(rot[7]) > eps || Math.abs(rot[4] - 1) > eps) return null;
  return Math.round(Math.atan2(rot[2], rot[0]) * 180 / Math.PI * 100) / 100 + 0; // +0 は -0 を 0 にする
}
/** Y軸まわり deg 度の回転行列(行優先。world.json の rot と同じ並び) */
export function rotY(deg) {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}

// ---- 3軸の回転(度)。Robloxの Orientation と同じ順序 R = Ry * Rx * Rz ----
export function eulerToRot(xDeg, yDeg, zDeg) {
  const d = Math.PI / 180;
  const cx = Math.cos(xDeg * d), sx = Math.sin(xDeg * d);
  const cy = Math.cos(yDeg * d), sy = Math.sin(yDeg * d);
  const cz = Math.cos(zDeg * d), sz = Math.sin(zDeg * d);
  return [
    cy * cz + sy * sx * sz, -cy * sz + sy * sx * cz, sy * cx,
    cx * sz, cx * cz, -sx,
    -sy * cz + cy * sx * sz, sy * sz + cy * sx * cz, cy * cx
  ];
}
/** 回転行列 → [x,y,z](度)。X=±90°(真上/真下を向く)では Z を 0 にまとめる */
export function rotToEuler(m) {
  const r2 = (v) => Math.round(v * 100) / 100 + 0;
  const x = Math.asin(Math.max(-1, Math.min(1, -m[5])));
  let y, z;
  if (Math.abs(m[5]) < 0.999999) { y = Math.atan2(m[2], m[8]); z = Math.atan2(m[3], m[4]); }
  else { y = Math.atan2(-m[6], m[0]); z = 0; }
  const k = 180 / Math.PI;
  return [r2(x * k), r2(y * k), r2(z * k)];
}

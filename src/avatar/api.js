// Roblox APIからユーザー・アバター情報を取得し、ビルダー用の記述子(descriptor)へ変換する。
// ブラウザから直接はCORSで叩けないため、worker/proxy.js(Cloudflare Worker)経由で取得する。
import { CONFIG } from '../config.js';
import { DEFAULT_SCALES, brickHex } from './rigs.js';
import { parseRbxm, isBinaryRbxm } from '../rbx/rbxm.js';
import { parseMeshAsync } from '../rbx/mesh.js';
import { extractAccessory, parseAssetUri } from '../rbx/accessory.js';
import { extractBodyPart } from '../rbx/bodypart.js';

export class ApiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function proxyBase() {
  const base = CONFIG.proxyBase.replace(/\/+$/, '');
  if (!base) throw new ApiError('NO_PROXY', 'プロキシURLが未設定です(設定画面で入力してください)');
  return base;
}

function proxied(url) {
  return `${proxyBase()}/?url=${encodeURIComponent(url)}`;
}

async function http(url, init) {
  const target = proxied(url);
  let res;
  try { res = await fetch(target, init); }
  catch (e) { throw new ApiError('NETWORK', '通信に失敗しました(プロキシURLを確認してください)'); }
  if (!res.ok) throw new ApiError(`HTTP_${res.status}`, `HTTP ${res.status}: ${url}`);
  return res;
}
const getJson = async (url, init) => (await http(url, init)).json();

/** ユーザー名またはユーザーID → { id, name, displayName } */
export async function resolveUser(input) {
  const s = String(input || '').trim().replace(/^@/, '');
  if (!s) throw new ApiError('EMPTY', 'ユーザー名かユーザーIDを入力してください');
  let id;
  if (/^\d+$/.test(s)) {
    id = Number(s);
  } else {
    const r = await getJson('https://users.roblox.com/v1/usernames/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: [s], excludeBannedUsers: false }),
    });
    const u = r && r.data && r.data[0];
    if (!u) throw new ApiError('NOT_FOUND', `ユーザー「${s}」が見つかりません`);
    id = u.id;
  }
  const info = await getJson(`https://users.roblox.com/v1/users/${id}`);
  return { id, name: info.name, displayName: info.displayName || info.name };
}

export const getAvatarJson = (userId) => getJson(`https://avatar.roblox.com/v1/users/${userId}/avatar`);

// ---- アセット取得 ----
const bytesCache = new Map();
const imageCache = new Map();

/**
 * アセット本体を取得する。Workerの /asset/{id} 経由で、Robloxへの認証(APIキー)はWorker側が行う。
 * 失敗時は原因ごとのApiErrorを投げる(NO_API_KEY / KEY_REJECTED / ASSET_UNAVAILABLE / RATE_LIMITED / OLD_WORKER ほか)。
 */
export async function fetchAssetBytes(id) {
  const base = proxyBase();
  let res;
  try { res = await fetch(`${base}/asset/${id}`); }
  catch (e) { throw new ApiError('NETWORK', '通信に失敗しました(プロキシURLを確認してください)'); }
  if (res.ok) return res.arrayBuffer();

  let code = '';
  try { code = (await res.json()).error || ''; } catch (e) { /* JSONではない応答 */ }
  if (code === 'NO_API_KEY') throw new ApiError('NO_API_KEY', 'アセットを取得できません: WorkerにROBLOX_API_KEYが設定されていません');
  if (code === 'KEY_REJECTED') throw new ApiError('KEY_REJECTED', 'アセットを取得できません: APIキーが無効か、期限切れです');
  if (code === 'NOT_FOUND') throw new ApiError('ASSET_UNAVAILABLE', `アセット ${id} が見つかりません`);
  if (code === 'RATE_LIMITED') throw new ApiError('RATE_LIMITED', 'アセット取得の回数制限に達しました。少し待ってから再読み込みしてください');
  if (code === 'ORIGIN_NOT_ALLOWED') throw new ApiError('ORIGIN_NOT_ALLOWED', 'このサイトからのアセット取得はWorkerに許可されていません(ALLOWED_ORIGINを確認)');
  if (!code && (res.status === 400 || res.status === 404)) {
    throw new ApiError('OLD_WORKER', 'Workerが古い可能性があります。最新のworker/proxy.jsを再デプロイしてください');
  }
  throw new ApiError(`HTTP_${res.status}`, `アセット ${id} の取得に失敗しました(HTTP ${res.status})`);
}

async function assetBytes(id) {
  if (bytesCache.has(id)) return bytesCache.get(id);
  const p = fetchAssetBytes(id);
  bytesCache.set(id, p);
  p.catch(() => bytesCache.delete(id));
  return p;
}

function isImageBytes(buf) {
  const b = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  return (b[0] === 0x89 && b[1] === 0x50) || (b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x47 && b[1] === 0x49);
}

/** XML形式のアセット(Shirt/Pants/T-Shirt/Decal)から、参照先の画像アセットIDを取り出す。 */
export function extractContentId(buf) {
  const head = new Uint8Array(buf, 0, Math.min(8, buf.byteLength));
  const magic = String.fromCharCode(...head);
  if (magic.startsWith('<roblox!')) return null; // バイナリ形式(rbxmパーサ導入後に対応)
  const text = new TextDecoder('latin1').decode(buf);
  const m = text.match(/rbxassetid:\/\/(\d+)/) || text.match(/[?&]id=(\d+)/);
  return m ? Number(m[1]) : null;
}

async function imageForAsset(id) {
  if (imageCache.has(id)) return imageCache.get(id);
  const p = (async () => {
    const buf = await assetBytes(id);
    if (!isImageBytes(buf)) throw new ApiError('NOT_IMAGE', `アセット ${id} は画像ではありません`);
    return createImageBitmap(new Blob([buf]));
  })();
  imageCache.set(id, p);
  p.catch(() => imageCache.delete(id));
  return p;
}

/** 服/顔のアセットID → 画像。直接画像ならそのまま、XMLなら参照先の画像を取得。 */
export async function textureForAsset(assetId) {
  const buf = await assetBytes(assetId);
  if (isImageBytes(buf)) return imageForAsset(assetId);
  const cid = extractContentId(buf);
  if (cid) return imageForAsset(cid);
  if (isBinaryRbxm(buf)) { // バイナリrbxm: 参照先の画像プロパティを探す
    const tree = parseRbxm(buf);
    for (const inst of tree.instances.values()) {
      for (const k of ['ShirtTemplate', 'PantsTemplate', 'Graphic', 'Texture']) {
        const id = parseAssetUri(inst.props[k]);
        if (id) return imageForAsset(id);
      }
    }
  }
  throw new ApiError('NO_TEXTURE', `アセット ${assetId} から画像を特定できません`);
}

/** アクセサリ(Hat/Hair/Face/Neck/Shoulder/Front/Back/Waist)を読み込む → 描画用データ */
export async function loadAccessory(assetId) {
  const buf = await assetBytes(assetId);
  if (!isBinaryRbxm(buf)) throw new ApiError('UNSUPPORTED_FORMAT', 'XML形式のアクセサリは未対応です');
  const acc = extractAccessory(parseRbxm(buf));
  if (!acc) throw new ApiError('NO_HANDLE', 'Handleが見つかりません');
  const meshId = parseAssetUri(acc.handle.meshUri);
  if (!meshId) throw new ApiError('NO_MESH', 'メッシュIDがありません(組み込みメッシュは未対応)');
  const geometry = await parseMeshAsync(await assetBytes(meshId));
  let texture = null;
  const texId = parseAssetUri(acc.handle.textureUri);
  if (texId) { try { texture = await textureForAsset(texId); } catch (e) { /* テクスチャ無しで表示 */ } }
  return { ...acc, geometry, texture };
}

/** ボディパーツ(Head/Torso/Arm/Leg/DynamicHead)を読み込む → { slot, rig, parts:{名前:{fixed,artist}} }(各infoにgeometry/texture付き) */
export async function loadBodyPart(assetId, rigType, slot) {
  const buf = await assetBytes(assetId);
  if (!isBinaryRbxm(buf)) throw new ApiError('UNSUPPORTED_FORMAT', 'XML形式のボディパーツは未対応です');
  const tree = parseRbxm(buf);
  const ex = extractBodyPart(tree, rigType, slot);
  if (!ex) {
    const w = tree.warnings.filter((x) => /Mesh|Texture/.test(x)).slice(0, 2).join(' / ');
    throw new ApiError('NO_PART', `${rigType}用のメッシュパーツがありません(標準形状か未対応の形式)${w ? ` 警告: ${w}` : ''}`);
  }
  const meshCache = new Map(), texCache = new Map();
  const infos = new Set();
  for (const e of Object.values(ex.parts)) { infos.add(e.fixed); infos.add(e.artist); }
  await Promise.all([...infos].filter(Boolean).map(async (info) => {
    const mid = parseAssetUri(info.meshUri);
    if (!meshCache.has(mid)) meshCache.set(mid, assetBytes(mid).then((b) => parseMeshAsync(b)));
    info.geometry = await meshCache.get(mid);
    const tid = parseAssetUri(info.textureUri);
    if (tid) {
      if (!texCache.has(tid)) texCache.set(tid, textureForAsset(tid).catch(() => null)); // テクスチャ無しでも表示
      info.texture = await texCache.get(tid);
    }
  }));
  return { slot, ...ex };
}

// ---- アバター記述子 ----
const ASSET_TYPE = { 2: 'tshirt', 11: 'shirt', 12: 'pants', 18: 'face' };
const BODY_SLOT = { 17: 'head', 79: 'head', 27: 'torso', 28: 'rightArm', 29: 'leftArm', 30: 'leftLeg', 31: 'rightLeg' }; // Head, DynamicHead, Torso, RightArm, LeftArm, LeftLeg, RightLeg
const ACCESSORY_TYPES = new Set([8, 41, 42, 43, 44, 45, 46, 47]); // Hat, Hair, Face, Neck, Shoulder, Front, Back, Waist

function hex(v, fallback) {
  if (!v) return fallback;
  const s = String(v).replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(s) ? `#${s.toUpperCase()}` : fallback;
}

function readColors(av) {
  const c3 = av.bodyColor3s || {};
  const ids = av.bodyColors || {};
  const key = (n) => hex(c3[`${n}Color3`], brickHex(ids[`${n}ColorId`]));
  return { head: key('head'), torso: key('torso'), leftArm: key('leftArm'), rightArm: key('rightArm'),
    leftLeg: key('leftLeg'), rightLeg: key('rightLeg') };
}

/**
 * avatar API のJSON → descriptor。
 * report: 各アセットの適用状況 [{ id, name, type, status:'ok'|'skip'|'error', note }]
 */
export async function buildDescriptor(av, onProgress = () => {}) {
  const rigType = av.playerAvatarType === 'R6' ? 'R6' : 'R15';
  const s = av.scales || {};
  const scales = { ...DEFAULT_SCALES, height: s.height ?? 1, width: s.width ?? 1, depth: s.depth ?? 1,
    head: s.head ?? 1, proportion: s.proportion ?? 0, bodyType: s.bodyType ?? 0 };
  const desc = { rigType, scales, colors: readColors(av), clothing: {}, face: null, accessories: [], bodyParts: {}, report: [] };

  const jobs = [];
  let done = 0;
  for (const a of av.assets || []) {
    const slot = ASSET_TYPE[a.assetType && a.assetType.id];
    const typeName = (a.assetType && a.assetType.name) || '?';
    const entry = { id: a.id, name: a.name, type: typeName, status: 'skip', note: '次フェーズで対応予定' };
    desc.report.push(entry);
    const isAcc = ACCESSORY_TYPES.has(a.assetType && a.assetType.id);
    const bodySlot = BODY_SLOT[a.assetType && a.assetType.id];
    if (!slot && !isAcc && !bodySlot) continue;
    jobs.push((async () => {
      try {
        if (bodySlot) {
          const bp = await loadBodyPart(a.id, rigType, bodySlot);
          desc.bodyParts[bodySlot] = bp;
          entry.status = 'ok'; entry.note = `適用済み(${Object.keys(bp.parts).length}パーツ)`;
          return;
        }
        if (isAcc) {
          const acc = await loadAccessory(a.id);
          acc.name = a.name;
          desc.accessories.push(acc);
        } else {
          const img = await textureForAsset(a.id);
          if (slot === 'face') desc.face = img; else desc.clothing[slot] = img;
        }
        entry.status = 'ok'; entry.note = '適用済み';
      } catch (e) {
        entry.status = 'error'; entry.note = e.message;
      } finally {
        done++; onProgress(done, jobs.length);
      }
    })());
  }
  onProgress(0, jobs.length);
  await Promise.all(jobs);
  return desc;
}

/** ユーザー入力 → { user, desc } まで一括 */
export async function loadUserAvatar(input, onStatus = () => {}) {
  onStatus('ユーザーを検索中…');
  const user = await resolveUser(input);
  onStatus(`${user.displayName} のアバター情報を取得中…`);
  const av = await getAvatarJson(user.id);
  const desc = await buildDescriptor(av, (d, n) => onStatus(`パーツを読み込み中… ${d}/${n}`));
  return { user, desc };
}

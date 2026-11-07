// アクセサリのユーザー調整(位置・回転・サイズ)。THREE非依存の純粋ロジック。
// avatar API の assets[].meta = { order, puffiness, position:{X,Y,Z}, rotation:{X,Y,Z}, scale:{X,Y,Z}, version } を読む。
// 単位: position=stud / rotation=度 / scale=倍率。座標系は rigs.js と同じ(Roblox準拠: Y上、正面は-Z)。
//
// 配置の式(builder.js の buildAccessoryMesh は M = T(bodyPos) * inverse(handleAttach) で置く):
//   M = T(bodyPos) * Adj * inverse(handleAttach')
//   handleAttach' = ハンドル側アタッチメントの位置を scale 倍したもの
//   Adj = T(position) * Rx*Ry*Rz(rotation)  ← ボディ側アタッチメントの座標系での微調整(Robloxの CFrame.Angles と同じ順)
// Adj を handleAttach に畳み込めば builder.js を変えずに済む: handleAttach'' = handleAttach' * inverse(Adj)

const IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const num = (v, d) => (Number.isFinite(v) ? v : d);
const vec = (o, d) => {
  if (!o || typeof o !== 'object') return d.slice();
  return [num(o.X ?? o.x, d[0]), num(o.Y ?? o.y, d[1]), num(o.Z ?? o.z, d[2])];
};
const clampScale = (v) => Math.min(10, Math.max(0.05, v));

/** 全アクセサリー共通の位置オフセット(stud)。[X(+右/-左), Y(+上), Z(+後ろ/-前)]。通常のヘアには適用しない。 */
export const GLOBAL_ACCESSORY_POS = [-0.1, 0, -0.2];
/** avatar API の assetType.id: Hair(通常のヘア)。調整の対象外 */
export const HAIR_ASSET_TYPE_ID = 41;

const mul3 = (A, B) => [
  A[0] * B[0] + A[1] * B[3] + A[2] * B[6], A[0] * B[1] + A[1] * B[4] + A[2] * B[7], A[0] * B[2] + A[1] * B[5] + A[2] * B[8],
  A[3] * B[0] + A[4] * B[3] + A[5] * B[6], A[3] * B[1] + A[4] * B[4] + A[5] * B[7], A[3] * B[2] + A[4] * B[5] + A[5] * B[8],
  A[6] * B[0] + A[7] * B[3] + A[8] * B[6], A[6] * B[1] + A[7] * B[4] + A[8] * B[7], A[6] * B[2] + A[7] * B[5] + A[8] * B[8],
];
const transpose = (R) => [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]];
const mulVec = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];

/** Robloxの CFrame.Angles(rx, ry, rz)(= Rx*Ry*Rz)。引数はラジアン。 */
export function eulerXYZ(rx, ry, rz) {
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  const Rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const Rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  return mul3(mul3(Rx, Ry), Rz);
}

/** assets[].meta → { pos, rot(度), scale }。調整が無い(または単位値)なら null。 */
export function readAdjust(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const pos = vec(meta.position, [0, 0, 0]);
  const rot = vec(meta.rotation, [0, 0, 0]);
  const scale = vec(meta.scale, [1, 1, 1]).map(clampScale);
  const none = pos.every((v) => v === 0) && rot.every((v) => v === 0) && scale.every((v) => v === 1);
  return none ? null : { pos, rot, scale };
}

/**
 * アセット1点ぶんの最終的な調整 = ユーザーの meta 調整 + 全アクセサリー共通オフセット。
 * 通常のヘア(assetTypeId=41)は対象外(null)。
 */
export function adjustFor(meta, assetTypeId) {
  if (assetTypeId === HAIR_ASSET_TYPE_ID) return null;
  const a = readAdjust(meta) || { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] };
  return { pos: a.pos.map((v, k) => v + GLOBAL_ACCESSORY_POS[k]), rot: a.rot, scale: a.scale };
}

/**
 * loadAccessory() の結果 acc に調整を焼き込む(新しい handle / attachment を作って差し替える)。
 * サイズ: ハンドルのメッシュを scale 倍し、ハンドル側アタッチメントの位置も同じ倍率で動かす(アタッチメントはHandleに付いているため)。
 * 位置・回転: ボディ側アタッチメントの座標系で動かす。
 */
export function applyAdjust(acc, adj) {
  if (!adj) return acc;
  const S = adj.scale;
  const h = { ...acc.handle };
  if (h.kind === 'meshpart') {
    h.size = h.size.map((v, k) => v * S[k]); // builderはメッシュのbboxをSizeへ合わせるので、Sizeを拡縮すればよい
  } else {
    h.scale = h.scale.map((v, k) => v * S[k]); // 生の頂点 × Scale + Offset
    h.offset = h.offset.map((v, k) => v * S[k]);
  }
  const att = acc.attachment || { name: 'HatAttachment', pos: [0, 0, 0], rot: IDENT };
  const p = att.pos.map((v, k) => v * S[k]);
  const d = Math.PI / 180;
  const Ra = eulerXYZ(adj.rot[0] * d, adj.rot[1] * d, adj.rot[2] * d);
  const Rn = mul3(att.rot || IDENT, transpose(Ra)); // 回転部: R_attach * inverse(R_adj)
  const t = mulVec(Rn, adj.pos);
  acc.handle = h;
  acc.attachment = { name: att.name, rot: Rn, pos: [p[0] - t[0], p[1] - t[1], p[2] - t[2]] };
  return acc;
}

/** ログ表示用の短い説明 */
export function describeAdjust(adj) {
  if (!adj) return '';
  const f = (a) => a.map((v) => +v.toFixed(3)).join(',');
  return `位置(${f(adj.pos)}) 回転(${f(adj.rot)}°) サイズ×(${f(adj.scale)})`;
}

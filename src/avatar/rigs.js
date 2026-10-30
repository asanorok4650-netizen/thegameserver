// リグ(パーツ構成)定義。THREE非依存の純粋ロジックのみ。
// 座標系はRoblox準拠: Y上、足裏がy=0、キャラの正面は -Z、右手は +X。単位はstud。

export const DEFAULT_SCALES = { height: 1, width: 1, depth: 1, head: 1, proportion: 0, bodyType: 0 };

// ---- クラシック服テンプレート(585x559)の各面の矩形 [x, y, w, h] ----
export const TEMPLATE = { w: 585, h: 559 };
const TORSO_RECTS = {
  front: [231, 74, 128, 128], back: [427, 74, 128, 128],
  right: [165, 74, 64, 128], left: [361, 74, 64, 128],
  top: [231, 8, 128, 64], bottom: [231, 204, 128, 64],
};
const RIGHT_LIMB_RECTS = { // アバターの右腕/右脚(画像の左側)
  top: [217, 289, 64, 64], bottom: [217, 483, 64, 64],
  front: [217, 355, 64, 128], right: [151, 355, 64, 128],
  back: [85, 355, 64, 128], left: [19, 355, 64, 128],
};
const LEFT_LIMB_RECTS = { // アバターの左腕/左脚(画像の右側)
  top: [308, 289, 64, 64], bottom: [308, 483, 64, 64],
  front: [308, 355, 64, 128], left: [374, 355, 64, 128],
  back: [440, 355, 64, 128], right: [506, 355, 64, 128],
};
export const CLOTH_RECTS = { torso: TORSO_RECTS, rLimb: RIGHT_LIMB_RECTS, lLimb: LEFT_LIMB_RECTS };

// BoxGeometryの面順(+x,-x,+y,-y,+z,-z) = Roblox面名
export const FACE_ORDER = ['right', 'left', 'top', 'bottom', 'back', 'front'];

// 服の貼り付け対象。layers: どの服を重ねるか
const CLOTH_GROUPS = {
  torso: { rects: 'torso', layers: ['pants', 'shirt', 'tshirt'] },
  lArm: { rects: 'lLimb', layers: ['shirt'] },
  rArm: { rects: 'rLimb', layers: ['shirt'] },
  lLeg: { rects: 'lLimb', layers: ['pants'] },
  rLeg: { rects: 'rLimb', layers: ['pants'] },
};

/**
 * パーツの面ごとのUV矩形を計算する(スライス対応)。
 * slice=[f0,f1] は元のR6パーツ(高さ2stud)を上から何割〜何割使うか。R15の分割パーツ用。
 */
export function faceRectsFor(clothKey, slice = [0, 1]) {
  const g = CLOTH_GROUPS[clothKey];
  const R = CLOTH_RECTS[g.rects];
  const [f0, f1] = slice;
  const side = (r) => [r[0], r[1] + f0 * r[3], r[2], Math.max(1, (f1 - f0) * r[3])];
  const strip = (r, f) => [r[0], r[1] + Math.min(f, 0.999) * r[3], r[2], 1];
  const out = {};
  for (const k of ['front', 'back', 'left', 'right']) out[k] = side(R[k]);
  out.top = f0 === 0 ? R.top : strip(R.front, f0);
  out.bottom = f1 === 1 ? R.bottom : strip(R.front, f1);
  return FACE_ORDER.map((n) => out[n]);
}
export function clothLayers(clothKey) { return CLOTH_GROUPS[clothKey].layers; }

// ---- R6 ----
export function layoutR6() {
  const P = (name, color, size, center, cloth, shape = 'box') => ({ name, color, size, center, cloth, shape, slice: [0, 1] });
  return [
    P('Head', 'head', [1.25, 1.25, 1.25], [0, 4.5, 0], null, 'head'),
    P('Torso', 'torso', [2, 2, 1], [0, 3, 0], 'torso'),
    P('Left Arm', 'leftArm', [1, 2, 1], [-1.5, 3, 0], 'lArm'),
    P('Right Arm', 'rightArm', [1, 2, 1], [1.5, 3, 0], 'rArm'),
    P('Left Leg', 'leftLeg', [1, 2, 1], [-0.5, 1, 0], 'lLeg'),
    P('Right Leg', 'rightLeg', [1, 2, 1], [0.5, 1, 0], 'rLeg'),
  ];
}

// ---- R15 ----
// ※サイズは標準R15の近似値。正確な値はR15リグのrbxm/rbxlから読み込む形に差し替え予定。
export function layoutR15(scales = DEFAULT_SCALES) {
  const w = scales.width, h = scales.height, d = scales.depth, hs = scales.head;
  const o = 0.08 * h; // 関節ごとの重なり
  const S = { foot: 0.3, lowerLeg: 1.193, upperLeg: 1.217, lowerTorso: 0.4, upperTorso: 1.6,
    upperArm: 1.169, lowerArm: 1.052, hand: 0.3, head: 1.2 };
  const parts = [];
  const add = (name, color, sx, sy, sz, cx, y0, cloth, slice, shape = 'box') => {
    parts.push({ name, color, size: [sx, sy, sz], center: [cx, y0 + sy / 2, 0], cloth, shape, slice });
  };
  // 脚(足→下腿→上腿)
  const foot = S.foot * h, lowerLeg = S.lowerLeg * h, upperLeg = S.upperLeg * h;
  const legTotal = S.lowerLeg + S.upperLeg;
  const yFoot0 = 0, yLL0 = foot - o, yUL0 = yLL0 + lowerLeg - o, yUL1 = yUL0 + upperLeg;
  const legSlices = { lower: [S.upperLeg / legTotal, 1], upper: [0, S.upperLeg / legTotal] };
  for (const side of [['Left', -1, 'leftLeg', 'lLeg'], ['Right', 1, 'rightLeg', 'rLeg']]) {
    const [N, sg, col, ck] = side, x = sg * 0.5 * w;
    add(`${N}Foot`, col, 1 * w, foot, 1 * d, x, yFoot0, null, [0, 1]);
    add(`${N}LowerLeg`, col, 1 * w, lowerLeg, 1 * d, x, yLL0, ck, legSlices.lower);
    add(`${N}UpperLeg`, col, 1 * w, upperLeg, 1 * d, x, yUL0, ck, legSlices.upper);
  }
  // 胴
  const lt = S.lowerTorso * h, ut = S.upperTorso * h;
  const yLT0 = yUL1 - o, yUT0 = yLT0 + lt - o * 0.5, yUT1 = yUT0 + ut;
  const torsoTotal = S.lowerTorso + S.upperTorso;
  add('LowerTorso', 'torso', 2 * w, lt, 1 * d, 0, yLT0, 'torso', [S.upperTorso / torsoTotal, 1]);
  add('UpperTorso', 'torso', 2 * w, ut, 1 * d, 0, yUT0, 'torso', [0, S.upperTorso / torsoTotal]);
  // 頭
  const head = S.head * hs * h;
  add('Head', 'head', head, head, head, 0, yUT1 - 0.05 * h, null, [0, 1], 'head');
  // 腕(肩の高さから下へ)
  const upperArm = S.upperArm * h, lowerArm = S.lowerArm * h, hand = S.hand * h;
  const armTotal = S.upperArm + S.lowerArm;
  const yShoulder = yUT1 - 0.1 * h;
  const yUA0 = yShoulder - upperArm, yLA0 = yUA0 + o - lowerArm, yHand0 = yLA0 + o - hand;
  const armSlices = { upper: [0, S.upperArm / armTotal], lower: [S.upperArm / armTotal, 1] };
  for (const side of [['Left', -1, 'leftArm', 'lArm'], ['Right', 1, 'rightArm', 'rArm']]) {
    const [N, sg, col, ck] = side, x = sg * 1.5 * w;
    add(`${N}UpperArm`, col, 1 * w, upperArm, 1 * d, x, yUA0, ck, armSlices.upper);
    add(`${N}LowerArm`, col, 1 * w, lowerArm, 1 * d, x, yLA0, ck, armSlices.lower);
    add(`${N}Hand`, col, 1 * w, hand, 1 * d, x, yHand0, null, [0, 1]);
  }
  return parts;
}

// ---- ボディ側アタッチメント(アクセサリの取り付け先) ----
// [R6のパーツ名, R6オフセット, R15のパーツ名, R15オフセット](パーツ中心からのstud)。※近似値。
export const BODY_ATTACH = {
  HatAttachment: ['Head', [0, 0.6, 0], 'Head', [0, 0.6, 0]],
  HairAttachment: ['Head', [0, 0.6, 0], 'Head', [0, 0.6, 0]],
  FaceFrontAttachment: ['Head', [0, 0, -0.6], 'Head', [0, 0, -0.6]],
  FaceCenterAttachment: ['Head', [0, 0, 0], 'Head', [0, 0, 0]],
  NeckAttachment: ['Torso', [0, 1, 0], 'UpperTorso', [0, 0.8, 0]],
  BodyFrontAttachment: ['Torso', [0, 0, -0.5], 'UpperTorso', [0, 0, -0.5]],
  BodyBackAttachment: ['Torso', [0, 0, 0.5], 'UpperTorso', [0, 0, 0.5]],
  LeftCollarAttachment: ['Torso', [-1, 1, 0], 'UpperTorso', [-1, 0.8, 0]],
  RightCollarAttachment: ['Torso', [1, 1, 0], 'UpperTorso', [1, 0.8, 0]],
  LeftShoulderAttachment: ['Left Arm', [0, 0.8, 0], 'LeftUpperArm', [0, 0.4, 0]],
  RightShoulderAttachment: ['Right Arm', [0, 0.8, 0], 'RightUpperArm', [0, 0.4, 0]],
  WaistFrontAttachment: ['Torso', [0, -0.8, -0.5], 'LowerTorso', [0, 0, -0.5]],
  WaistBackAttachment: ['Torso', [0, -0.8, 0.5], 'LowerTorso', [0, 0, 0.5]],
  WaistCenterAttachment: ['Torso', [0, -0.8, 0], 'LowerTorso', [0, 0, 0]],
};

/** 取り付け先のワールド位置。layoutは layoutFor() の結果。見つからなければ null。 */
export function bodyAttachPoint(rigType, layout, attName) {
  const e = BODY_ATTACH[attName];
  if (!e) return null;
  const [pn, off] = rigType === 'R6' ? [e[0], e[1]] : [e[2], e[3]];
  const part = layout.find((p) => p.name === pn);
  if (!part) return null;
  const k = pn === 'Head' && rigType !== 'R6' ? part.size[1] / 1.2 : 1; // R15頭のスケール追従
  return { part: pn, pos: [part.center[0] + off[0] * k, part.center[1] + off[1] * k, part.center[2] + off[2] * k] };
}

export function layoutFor(rigType, scales) {
  return rigType === 'R6' ? layoutR6() : layoutR15(scales || DEFAULT_SCALES);
}

// ---- BrickColor(ID→色) 主要色のみ。bodyColor3sがあればそちらを優先 ----
export const BRICK_HEX = {
  1: '#F2F3F3', 5: '#D7C59A', 9: '#E8BAC8', 18: '#CC8E69', 21: '#C4281C', 23: '#0D69AC', 24: '#F5CD30',
  26: '#1B2A35', 28: '#287F47', 37: '#4B974B', 38: '#A05F35', 45: '#B4D2E4', 101: '#DA867A', 102: '#6E99CA',
  104: '#6B327C', 105: '#E29B40', 106: '#DA8541', 119: '#A4BD47', 125: '#EAB892', 135: '#74869D',
  141: '#27462D', 192: '#694028', 194: '#A3A2A5', 199: '#635F62', 208: '#E5E4DF', 217: '#7C5C46',
  226: '#FDEA8D', 268: '#342B75', 292: '#7C9C6B', 306: '#9FC3E9', 308: '#3D1585', 1001: '#F8F8F8',
  1002: '#CDCDCD', 1003: '#111111', 1004: '#FF0000', 1005: '#FFAF00', 1006: '#B480FF', 1007: '#A34B4B',
  1008: '#C1BE42', 1009: '#FFFF00', 1010: '#0000FF', 1011: '#002060', 1012: '#2154B9', 1013: '#04AFEC',
  1014: '#AA5500', 1015: '#AA00AA', 1016: '#FF66CC', 1017: '#FFAF00', 1018: '#12EED4', 1019: '#00FFFF',
  1020: '#00FF00', 1021: '#3A7D15', 1022: '#7F8E64', 1023: '#8C5B9F', 1024: '#AFDDFF', 1025: '#FFC9C9',
  1026: '#B1A7FF', 1027: '#9FF3E9', 1028: '#CCFFCC', 1029: '#FFFFCC', 1030: '#FFCC99', 1031: '#6225D1',
  1032: '#FF00BF',
};
export function brickHex(id, fallback = '#A3A2A5') { return BRICK_HEX[id] || fallback; }

// ボディパーツ(Head/Torso/Arm/Leg/DynamicHead)のアセットから、描画に必要な情報を取り出す。THREE非依存。
// R15: MeshPart(UpperTorso など)。R15ArtistIntent / R15Fixed フォルダがあれば両方を保持する。
// R6 : Part + SpecialMesh(FileMesh)。R6 フォルダがあればそちらを優先。
// 頭だけは、親の Part が無い「裸の SpecialMesh」1個だけのアセット(クラシックの頭)もある。その場合はメッシュだけを頭として使う。
import { parseAssetUri, readSpecialMesh } from './accessory.js';
import { isPrimitiveType } from './primitives.js';

export const R15_NAMES = {
  head: ['Head'], torso: ['UpperTorso', 'LowerTorso'],
  leftArm: ['LeftUpperArm', 'LeftLowerArm', 'LeftHand'], rightArm: ['RightUpperArm', 'RightLowerArm', 'RightHand'],
  leftLeg: ['LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot'], rightLeg: ['RightUpperLeg', 'RightLowerLeg', 'RightFoot'],
};
export const R6_NAMES = { head: 'Head', torso: 'Torso', leftArm: 'Left Arm', rightArm: 'Right Arm', leftLeg: 'Left Leg', rightLeg: 'Right Leg' };

const IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const nm = (i) => (i.props.Name !== undefined ? i.props.Name : i.className);

function inFolder(inst, names) {
  for (let p = inst.parent; p; p = p.parent) if (names.includes(nm(p))) return true;
  return false;
}

function colorOf(p) {
  const c = p.Color3uint8 || p.Color3 || p.Color;
  if (!Array.isArray(c) || c.length !== 3) return null;
  return c.some((v) => v > 1.0001) ? c.map((v) => v / 255) : c;
}

/** 1パーツ分の情報。メッシュが無い(標準の箱/頭)ときは null。 */
function readPart(inst) {
  const p = inst.props;
  const info = { size: p.Size || [1, 1, 1], color: colorOf(p), transparency: p.Transparency || 0,
    meshUri: null, textureUri: null, scale: [1, 1, 1], offset: [0, 0, 0], attachments: {}, cframe: p.CFrame || null };
  if (inst.className === 'MeshPart') {
    info.kind = 'meshpart';
    info.meshUri = p.MeshId || p.MeshContent || null;
    info.textureUri = p.TextureID || p.TextureId || p.TextureContent || null;
  } else {
    const sm = inst.children.find((c) => c.className === 'SpecialMesh');
    if (!sm) return null;
    info.kind = 'special';
    Object.assign(info, readSpecialMesh(sm));
  }
  if (!info.textureUri) { // SurfaceAppearance の ColorMap
    const sa = inst.children.find((c) => c.className === 'SurfaceAppearance');
    if (sa) info.textureUri = sa.props.ColorMap || sa.props.ColorMapContent || null;
  }
  if (!isPrimitiveType(info.meshType) && !parseAssetUri(info.meshUri)) return null; // 組み込み形状(Brick/Sphere等)はメッシュID不要
  for (const a of inst.children) {
    if (a.className !== 'Attachment' || !a.props.CFrame) continue;
    info.attachments[nm(a)] = { pos: a.props.CFrame.pos, rot: a.props.CFrame.rot || IDENT };
  }
  return info;
}

/**
 * 親の Part が無い SpecialMesh(FileMesh)だけから、頭の情報を作る。Part.Size が無いので標準の頭の大きさで代用する
 * (R15=1.2 の立方体 / R6=2×1×1)。アタッチメントは無し(頭の位置・帽子の取り付けは標準位置)。
 */
function readBareSpecialMesh(sm, rigType) {
  const s = readSpecialMesh(sm);
  if (isPrimitiveType(s.meshType) || !parseAssetUri(s.meshUri)) return null;
  return { size: rigType === 'R6' ? [2, 1, 1] : [1.2, 1.2, 1.2], color: null, transparency: 0, kind: 'special',
    meshType: s.meshType, meshUri: s.meshUri, textureUri: s.textureUri, scale: s.scale, offset: s.offset,
    attachments: {}, cframe: null };
}

/**
 * @returns null | { rig, parts: { [partName]: { fixed: info|null, artist: info|null } } }
 *   info = { kind, size, color, transparency, meshUri, textureUri, scale, offset, attachments }
 */
export function extractBodyPart(tree, rigType, slot) {
  const parts = [...tree.instances.values()].filter((i) => /Part$/.test(i.className));
  const out = {};
  if (rigType === 'R6') {
    const name = R6_NAMES[slot];
    const c = parts.filter((i) => nm(i) === name && !inFolder(i, ['R15ArtistIntent', 'R15Fixed', 'R15']));
    const inst = c.find((i) => inFolder(i, ['R6'])) || c[0];
    const info = inst && readPart(inst);
    if (info) out[name] = { fixed: info, artist: info };
  } else {
    for (const name of R15_NAMES[slot]) {
      const c = parts.filter((i) => nm(i) === name && !inFolder(i, ['R6']));
      const read = (i) => (i ? readPart(i) : null);
      const artist = read(c.find((i) => inFolder(i, ['R15ArtistIntent'])));
      const fixed = read(c.find((i) => inFolder(i, ['R15Fixed'])));
      const plain = read(c.find((i) => !inFolder(i, ['R15ArtistIntent', 'R15Fixed'])));
      const e = { fixed: fixed || plain || artist, artist: artist || plain || fixed };
      if (e.fixed || e.artist) out[name] = e;
    }
  }
  if (!Object.keys(out).length && rigType !== 'R6' && slot === 'head') {
    // DynamicHeadなど: 名前が違っていても、メッシュ(FileMesh)を持つパーツ(MeshPart / Part+SpecialMesh)を頭として使う。
    // R15用が無いR6専用の頭(Part+SpecialMesh)は、Robloxと同様にR15でもそのメッシュを頭に当てる(R6フォルダ内も探す)。
    // 組み込み形状(Head/Brick等)のSpecialMeshは対象外(標準の頭のまま)。
    const find = (list) => {
      const cand = list.map((i) => ({ i, info: readPart(i) })).filter((x) => x.info && !isPrimitiveType(x.info.meshType));
      return cand.find((x) => /head/i.test(nm(x.i))) || cand[0];
    };
    const pick = find(parts.filter((i) => !inFolder(i, ['R6']))) || find(parts.filter((i) => inFolder(i, ['R6'])));
    if (pick) out.Head = { fixed: pick.info, artist: pick.info };
  }
  if (!Object.keys(out).length && slot === 'head') {
    // 親の Part が無い裸の SpecialMesh(クラシックの頭アセット)。FileMeshのものだけを頭のメッシュとして使う
    for (const sm of tree.instances.values()) {
      if (sm.className !== 'SpecialMesh' || (sm.parent && /Part$/.test(sm.parent.className))) continue;
      const info = readBareSpecialMesh(sm, rigType);
      if (info) { out.Head = { fixed: info, artist: info }; break; }
    }
  }
  return Object.keys(out).length ? { rig: rigType, parts: out } : null;
}

/** 失敗時の調査用: メッシュ関連インスタンスの一覧(クラス:名前(メッシュID))。 */
export function describeTree(tree, max = 10) {
  const items = [...tree.instances.values()].filter((i) => /Part$/.test(i.className) || i.className === 'SpecialMesh');
  const f = (i) => `${i.className}:${nm(i)}(${String(i.props.MeshId || i.props.MeshContent || 'メッシュ指定なし').slice(0, 28)})`;
  return `${items.length}件 [${items.slice(0, max).map(f).join(', ')}${items.length > max ? ', …' : ''}]`;
}

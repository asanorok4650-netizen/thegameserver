// アバターのパーツ組み立て: 記述子(descriptor)→ THREE.Group
// サムネイルは使わず、リグの各パーツ(Box/Head)をBodyColors・クラシック服・顔で組み上げる。
import * as THREE from 'three';
import { layoutFor, faceRectsFor, clothLayers, CLOTH_RECTS, TEMPLATE, bodyAttachPoint } from './rigs.js';
import { applyBodyParts, describeBodyParts } from './bodyparts.js';

/** 角を丸めたBox(R6/R15のHeadの近似)。法線は解析的に求めて継ぎ目を消す。 */
function roundedBoxGeometry(size, radius) {
  const [w, h, d] = size;
  const geo = new THREE.BoxGeometry(w, h, d, 8, 8, 8);
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const inner = new THREE.Vector3(w / 2 - radius, h / 2 - radius, d / 2 - radius);
  const p = new THREE.Vector3(), q = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    q.set(Math.max(-inner.x, Math.min(inner.x, p.x)), Math.max(-inner.y, Math.min(inner.y, p.y)),
      Math.max(-inner.z, Math.min(inner.z, p.z)));
    n.copy(p).sub(q);
    const len = n.length();
    if (len > 1e-6) { n.divideScalar(len); p.copy(q).addScaledVector(n, radius); } else { n.fromBufferAttribute(nor, i); }
    pos.setXYZ(i, p.x, p.y, p.z);
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  return geo;
}

/** BoxGeometry(分割1)のUVを、服テンプレートの矩形に差し替える。 */
function remapBoxUV(geo, faceRects) {
  const uv = geo.attributes.uv;
  for (let f = 0; f < 6; f++) {
    const r = faceRects[f];
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      let u = uv.getX(idx);
      let v = uv.getY(idx);
      // top/bottom は three側の向きとテンプレートの向きが180°回転の関係(正面が上下逆)なので u・v とも反転
      if (f === 2 || f === 3) { u = 1 - u; v = 1 - v; }
      uv.setXY(idx, (r[0] + u * r[2]) / TEMPLATE.w, 1 - (r[1] + (1 - v) * r[3]) / TEMPLATE.h);
    }
  }
  uv.needsUpdate = true;
}

/**
 * メッシュ(カスタム)パーツ用: メッシュ自身のUVには頼らず、バウンディングボックスへの箱投影でテンプレートUVを振り直す。
 * 三角形ごとに法線で面(+x,-x,+y,-y,+z,-z)を決めるので、面の境目で引き伸ばされない(その分、頂点を分離した非インデックス形状になる)。
 * 面ごとのu/vの向きは remapBoxUV(標準の箱)と同じ。返すUVは v=0 が画像の上(texture.flipY=false 用)。
 * skipNeck: 上半身(UpperTorso)の上に突き出た首には服を貼らない。服の縦の基準は、首を除いた胴の本体の高さにする。
 *           首の三角形は末尾にまとめ、geometry.groups の materialIndex=1(=ボディカラーのみの素材)にする。
 *           首 = 本体の上端(肩の最高点)より上にある「ほぼ垂直な側面」または「首の上半分(先端)」。
 *           肩の上面の斜面(首の付け根に向かって上がる部分)は胴の上面として、服(ネックレス等)を貼る。
 */
function projectClothUV(srcGeo, faceRects, skipNeck = false) {
  const geo = srcGeo.index ? srcGeo.toNonIndexed() : srcGeo;
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
  const w = bb.max.x - bb.min.x || 1, d = bb.max.z - bb.min.z || 1;
  // 胴の本体の上端: 横幅の外側(肩まわり)にある頂点の最高点。首の突起が無ければ bbox の上端と同じ
  let top = bb.max.y;
  if (skipNeck) {
    let ys = -Infinity;
    for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getX(i) - cx) > w * 0.3) ys = Math.max(ys, pos.getY(i));
    if (Number.isFinite(ys) && ys < bb.max.y - (bb.max.y - bb.min.y) * 0.03) top = ys;
  }
  const neck = top < bb.max.y;
  const neckMid = top + (bb.max.y - top) * 0.5; // 首の上半分(先端)の境目
  const h = top - bb.min.y || 1;
  const cy = (top + bb.min.y) / 2;
  const nTri = Math.floor(pos.count / 3);
  const neckTri = new Uint8Array(nTri);
  const uvs = new Float32Array(pos.count * 2);
  const c01 = (x) => Math.min(1, Math.max(0, x));
  for (let t = 0; t + 2 < pos.count; t += 3) {
    let nx = 0, ny = 0, nz = 0;
    for (let k = 0; k < 3; k++) { nx += nor.getX(t + k); ny += nor.getY(t + k); nz += nor.getZ(t + k); }
    if (neck) {
      const gy = (pos.getY(t) + pos.getY(t + 1) + pos.getY(t + 2)) / 3;
      if (gy > top + 1e-4) {
        const len = Math.hypot(nx, ny, nz) || 1;
        if (Math.abs(ny) / len < 0.5 || gy > neckMid) { neckTri[t / 3] = 1; continue; } // 首の側面・先端
      }
    }
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    let f;
    if (ax >= ay && ax >= az) f = nx > 0 ? 0 : 1;
    else if (ay >= az) f = ny > 0 ? 2 : 3;
    else f = nz > 0 ? 4 : 5;
    const r = faceRects[f];
    for (let k = 0; k < 3; k++) {
      const x = pos.getX(t + k) - cx, y = pos.getY(t + k) - cy, z = pos.getZ(t + k) - cz;
      let u, v; // BoxGeometryの各面と同じ向き(v=1が上)
      if (f === 0) { u = (d / 2 - z) / d; v = (y + h / 2) / h; }
      else if (f === 1) { u = (z + d / 2) / d; v = (y + h / 2) / h; }
      else if (f === 2) { u = (x + w / 2) / w; v = 1 - (z + d / 2) / d; }
      else if (f === 3) { u = (x + w / 2) / w; v = (z + d / 2) / d; }
      else if (f === 4) { u = (x + w / 2) / w; v = (y + h / 2) / h; }
      else { u = (w / 2 - x) / w; v = (y + h / 2) / h; }
      u = c01(u); v = c01(v);
      if (f === 2 || f === 3) { u = 1 - u; v = 1 - v; }
      uvs[(t + k) * 2] = (r[0] + u * r[2]) / TEMPLATE.w;
      uvs[(t + k) * 2 + 1] = (r[1] + (1 - v) * r[3]) / TEMPLATE.h;
    }
  }
  let nNeck = 0;
  for (let i = 0; i < nTri; i++) nNeck += neckTri[i];
  if (nNeck && nNeck < nTri) { // 首の三角形を末尾に並べ替えて、素材グループ(0=服つき, 1=ボディカラー)に分ける
    const order = [];
    for (let i = 0; i < nTri; i++) if (!neckTri[i]) order.push(i);
    for (let i = 0; i < nTri; i++) if (neckTri[i]) order.push(i);
    const reorder = (src, size) => {
      const dst = new Float32Array(src.length);
      order.forEach((ti, n) => { for (let j = 0; j < 3 * size; j++) dst[n * 3 * size + j] = src[ti * 3 * size + j]; });
      return new THREE.BufferAttribute(dst, size);
    };
    const pArr = pos.array, nArr = nor.array;
    geo.setAttribute('position', reorder(pArr, 3));
    geo.setAttribute('normal', reorder(nArr, 3));
    geo.setAttribute('uv', reorder(uvs, 2));
    geo.clearGroups();
    geo.addGroup(0, (nTri - nNeck) * 3, 0);
    geo.addGroup((nTri - nNeck) * 3, nNeck * 3, 1);
  } else {
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  }
  return geo;
}

/** R15でカスタムパーツを含む上下の組(胴・腕・脚)は、実際のパーツ高さの比で服テンプレートの縦の分割位置を決め直す。 */
const SLICE_GROUPS = [['UpperTorso', 'LowerTorso'], ['LeftUpperArm', 'LeftLowerArm'], ['RightUpperArm', 'RightLowerArm'],
  ['LeftUpperLeg', 'LeftLowerLeg'], ['RightUpperLeg', 'RightLowerLeg']];
function refineSlices(layout) {
  const by = Object.fromEntries(layout.map((d) => [d.name, d]));
  for (const [a, b] of SLICE_GROUPS) {
    const A = by[a], B = by[b];
    if (!A || !B || !(A.custom || B.custom)) continue;
    const f = A.size[1] / (A.size[1] + B.size[1]);
    A.slice = [0, f]; B.slice = [f, 1];
  }
}

function newTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * 自前テクスチャ付きのボディパーツ用: ボディカラーの上にテクスチャを重ねる。
 * 透明部分(肌など)をそのまま描くと黒くなるので、そこにボディカラーが出るようにする。UVは v=0 が画像の上(flipY=false)。
 */
function textureOverColor(img, colorHex) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.fillStyle = colorHex;
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0);
  const t = newTexture(c);
  t.flipY = false;
  return t;
}

/** ボディカラーで塗ったテンプレートの上に、パンツ→シャツ→Tシャツの順に重ねる。 */
function paintClothCanvas(colorHex, layers, clothing) {
  const c = document.createElement('canvas');
  c.width = TEMPLATE.w; c.height = TEMPLATE.h;
  const g = c.getContext('2d');
  g.fillStyle = colorHex;
  g.fillRect(0, 0, c.width, c.height);
  for (const L of layers) {
    const img = clothing[L];
    if (!img) continue;
    if (L === 'tshirt') { const r = CLOTH_RECTS.torso.front; g.drawImage(img, r[0], r[1], r[2], r[3]); }
    else g.drawImage(img, 0, 0, c.width, c.height);
  }
  return c;
}

/** 既定の顔(にっこり)。カスタムの顔が無い場合に使う。 */
function defaultFaceCanvas() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#1b1b1b';
  g.beginPath(); g.ellipse(88, 98, 12, 20, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(168, 98, 12, 20, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#1b1b1b'; g.lineWidth = 10; g.lineCap = 'round';
  g.beginPath(); g.arc(128, 128, 62, Math.PI * 0.18, Math.PI * 0.82); g.stroke();
  return c;
}

function faceCanvasFrom(bitmap) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  c.getContext('2d').drawImage(bitmap, 0, 0, 256, 256);
  return c;
}

/**
 * アクセサリ1点をメッシュ化して、ボディのアタッチメントに合わせて配置する。
 * Handle側アタッチメントとボディ側アタッチメントを一致させる: M = T(bodyPos) * inverse(handleAttachCFrame)
 */
function buildAccessoryMesh(acc, rigType, layout) {
  const g = acc.geometry, h = acc.handle;
  const pos = new Float32Array(g.positions);
  if (h.kind === 'meshpart') { // MeshPart: バウンディングボックス中心を原点に、Sizeへ合わせて拡縮
    const mn = g.bbox.min, mx = g.bbox.max;
    for (let i = 0; i < pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const ext = mx[k] - mn[k] || 1;
        pos[i + k] = (pos[i + k] - (mn[k] + mx[k]) / 2) * ((h.size[k] || ext) / ext);
      }
    }
  } else { // SpecialMesh(FileMesh): 生の頂点 × Scale + Offset
    for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) pos[i + k] = pos[i + k] * h.scale[k] + h.offset[k];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(g.normals), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.uvs), 2));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(g.indices), 1));

  let map = null;
  if (acc.texture) { map = new THREE.Texture(acc.texture); map.flipY = false; map.colorSpace = THREE.SRGBColorSpace; map.needsUpdate = true; }
  const c = h.color;
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.8, side: THREE.DoubleSide,
    color: map || !c ? 0xffffff : new THREE.Color(c[0], c[1], c[2]),
    transparent: h.transparency > 0, opacity: 1 - (h.transparency || 0) });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = `Accessory: ${acc.name}`;
  mesh.castShadow = true;

  const att = acc.attachment || { name: 'HatAttachment', pos: [0, 0, 0], rot: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
  const body = bodyAttachPoint(rigType, layout, att.name) || bodyAttachPoint(rigType, layout, 'HatAttachment');
  const R = att.rot, p = att.pos;
  const Rt = [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]]; // 転置 = 逆回転
  const inv = [-(Rt[0] * p[0] + Rt[1] * p[1] + Rt[2] * p[2]), -(Rt[3] * p[0] + Rt[4] * p[1] + Rt[5] * p[2]), -(Rt[6] * p[0] + Rt[7] * p[1] + Rt[8] * p[2])];
  mesh.matrixAutoUpdate = false;
  mesh.matrix.set(Rt[0], Rt[1], Rt[2], body.pos[0] + inv[0],
    Rt[3], Rt[4], Rt[5], body.pos[1] + inv[1],
    Rt[6], Rt[7], Rt[8], body.pos[2] + inv[2],
    0, 0, 0, 1);
  return { mesh, attachedTo: body.part };
}

/** カスタムのボディパーツ1つをメッシュ化する。頭なら顔も、服の対象パーツで自前テクスチャが無ければクラシック服も貼る。 */
function buildCustomPart(def, colorHex, faceBitmap, clothing = {}) {
  const info = def.custom.info, g = info.geometry;
  const pos = new Float32Array(g.positions);
  if (info.kind === 'meshpart') { // バウンディングボックス中心を原点に、Sizeへ合わせて拡縮
    const mn = g.bbox.min, mx = g.bbox.max;
    for (let i = 0; i < pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const ext = mx[k] - mn[k] || 1;
        pos[i + k] = (pos[i + k] - (mn[k] + mx[k]) / 2) * ((def.size[k] || ext) / ext);
      }
    }
  } else { // SpecialMesh: 生の頂点 × Scale + Offset
    for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) pos[i + k] = pos[i + k] * info.scale[k] + info.offset[k];
  }
  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(g.normals), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.uvs), 2));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(g.indices), 1));
  let map = null;
  if (info.texture) map = textureOverColor(info.texture, colorHex); // 透明部分にボディカラーを出す(黒ずみ防止)
  // 自前テクスチャが無い胴・腕・脚には、ボディカラー+クラシック服のテンプレートを箱投影で貼る(手・足・頭は対象外)
  let clothed = false;
  if (!map && def.cloth && def.shape !== 'head' && clothLayers(def.cloth).some((L) => clothing[L])) {
    geo = projectClothUV(geo, faceRectsFor(def.cloth, def.slice), def.name === 'UpperTorso');
    map = newTexture(paintClothCanvas(colorHex, clothLayers(def.cloth), clothing));
    map.flipY = false; // projectClothUV は v=0 が画像の上
    clothed = true;
  }
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.8, side: THREE.DoubleSide,
    color: map ? 0xffffff : colorHex, transparent: info.transparency > 0, opacity: 1 - (info.transparency || 0) });
  let material = mat;
  if (geo.groups.length > 1) { // 首の突起など、服を貼らない部分はボディカラーのみの素材(グループ1)
    const skin = mat.clone();
    skin.map = null;
    skin.color.set(colorHex);
    skin.needsUpdate = true;
    material = [mat, skin];
  }
  const mesh = new THREE.Mesh(geo, material);
  mesh.userData.clothed = clothed;
  if (info.transparency >= 0.99) mesh.visible = false; // ヘッドレスなど
  // 顔の板: 顔アセットがある、または頭メッシュに顔が焼き込まれていない(自前テクスチャ無し)ときだけ付ける。
  // 顔入りテクスチャ付きの頭(ダイナミックヘッド等)に既定のにっこり顔を重ねると、頭から浮いて見えてしまう。
  if (def.shape === 'head' && info.transparency < 0.99 && (faceBitmap || !info.texture)) {
    geo.computeBoundingBox();
    const bb = geo.boundingBox, cx = (bb.min.x + bb.max.x) / 2, cy = (bb.min.y + bb.max.y) / 2, w = bb.max.x - bb.min.x;
    let zFront = Infinity; // 顔の中心付近で一番手前の頂点に合わせる(曲面でも浮きにくい)
    for (let i = 0; i < pos.length; i += 3) {
      if (Math.abs(pos[i] - cx) < w * 0.2 && Math.abs(pos[i + 1] - cy) < w * 0.2) zFront = Math.min(zFront, pos[i + 2]);
    }
    if (!Number.isFinite(zFront)) zFront = bb.min.z;
    const fs = w * 0.62;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(fs, fs),
      new THREE.MeshBasicMaterial({ map: newTexture(faceBitmap ? faceCanvasFrom(faceBitmap) : defaultFaceCanvas()),
        transparent: true, polygonOffset: true, polygonOffsetFactor: -2 }));
    face.name = 'Face';
    face.rotation.y = Math.PI;
    face.position.set(cx, cy, zFront - 0.004);
    mesh.add(face);
  }
  return mesh;
}

/**
 * @param desc { rigType:'R6'|'R15', colors:{head,torso,leftArm,rightArm,leftLeg,rightLeg}, scales,
 *               clothing:{shirt,pants,tshirt}(ImageBitmap|Canvas|null), face:(ImageBitmap|Canvas|null) }
 */
export function buildAvatar(desc) {
  const group = new THREE.Group();
  group.name = `Avatar_${desc.rigType}`;
  const clothing = desc.clothing || {};
  const parts = [];

  const layout = applyBodyParts(layoutFor(desc.rigType, desc.scales), desc.rigType, desc.scales || {}, desc.bodyParts).layout;
  if (desc.rigType !== 'R6') refineSlices(layout);
  const diag = layout.some((d) => d.custom) ? describeBodyParts(layout, desc.scales || {}) : '';
  for (const def of layout) {
    const colorHex = (desc.colors && desc.colors[def.color]) || '#A3A2A5';
    let mesh;
    if (def.custom) {
      mesh = buildCustomPart(def, colorHex, desc.face, clothing);
    } else if (def.shape === 'head') {
      const geo = roundedBoxGeometry(def.size, 0.22 * def.size[0] / 1.25);
      mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.75 }));
      const fs = def.size[0] * 0.62;
      const faceTex = newTexture(desc.face ? faceCanvasFrom(desc.face) : defaultFaceCanvas());
      const face = new THREE.Mesh(new THREE.PlaneGeometry(fs, fs),
        new THREE.MeshBasicMaterial({ map: faceTex, transparent: true, polygonOffset: true, polygonOffsetFactor: -2 }));
      face.name = 'Face';
      face.rotation.y = Math.PI; // 正面(-Z)へ向ける
      face.position.z = -(def.size[2] / 2) - 0.004;
      mesh.add(face);
    } else {
      const geo = new THREE.BoxGeometry(def.size[0], def.size[1], def.size[2]);
      let mat;
      const usable = def.cloth ? clothLayers(def.cloth).filter((L) => clothing[L]) : [];
      if (usable.length) {
        remapBoxUV(geo, faceRectsFor(def.cloth, def.slice));
        mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8,
          map: newTexture(paintClothCanvas(colorHex, clothLayers(def.cloth), clothing)) });
      } else {
        mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.75 });
      }
      mesh = new THREE.Mesh(geo, mat);
    }
    mesh.name = def.name;
    mesh.position.set(def.center[0], def.center[1], def.center[2]);
    mesh.castShadow = true;
    if (def.rot) mesh.setRotationFromMatrix(new THREE.Matrix4().set(def.rot[0], def.rot[1], def.rot[2], 0,
      def.rot[3], def.rot[4], def.rot[5], 0, def.rot[6], def.rot[7], def.rot[8], 0, 0, 0, 0, 1));
    group.add(mesh);
    parts.push({ name: def.name, color: def.color, object: mesh, custom: !!def.custom,
      clothed: def.custom ? !!mesh.userData.clothed
        : !!(def.cloth && clothLayers(def.cloth).some((L) => clothing[L])) });
  }
  for (const acc of desc.accessories || []) {
    try {
      const { mesh, attachedTo } = buildAccessoryMesh(acc, desc.rigType, layout);
      group.add(mesh);
      parts.push({ name: acc.name, color: null, object: mesh, clothed: false, accessory: true, attachedTo });
    } catch (e) {
      parts.push({ name: acc.name, color: null, object: new THREE.Group(), clothed: false, accessory: true, error: e.message });
    }
  }
  const box = new THREE.Box3().setFromObject(group);
  return { group, parts, box, rigType: desc.rigType, diag };
}

export function disposeObject(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
  });
}

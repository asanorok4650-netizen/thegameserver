// アバターのパーツ組み立て: 記述子(descriptor)→ THREE.Group
// サムネイルは使わず、リグの各パーツ(Box/Head)をBodyColors・クラシック服・顔で組み上げる。
import * as THREE from 'three';
import { layoutFor, faceRectsFor, clothLayers, CLOTH_RECTS, TEMPLATE, bodyAttachPoint } from './rigs.js';

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

function newTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
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

/**
 * @param desc { rigType:'R6'|'R15', colors:{head,torso,leftArm,rightArm,leftLeg,rightLeg}, scales,
 *               clothing:{shirt,pants,tshirt}(ImageBitmap|Canvas|null), face:(ImageBitmap|Canvas|null) }
 */
export function buildAvatar(desc) {
  const group = new THREE.Group();
  group.name = `Avatar_${desc.rigType}`;
  const clothing = desc.clothing || {};
  const parts = [];

  const layout = layoutFor(desc.rigType, desc.scales);
  for (const def of layout) {
    const colorHex = (desc.colors && desc.colors[def.color]) || '#A3A2A5';
    let mesh;
    if (def.shape === 'head') {
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
    group.add(mesh);
    parts.push({ name: def.name, color: def.color, object: mesh, clothed: !!(def.cloth && clothLayers(def.cloth).some((L) => clothing[L])) });
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
  return { group, parts, box, rigType: desc.rigType };
}

export function disposeObject(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
  });
}

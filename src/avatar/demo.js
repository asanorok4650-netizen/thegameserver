// オフラインで動くデモアバター(プロキシ未設定でもパーツ組み立てを確認できる)
import { DEFAULT_SCALES, CLOTH_RECTS, TEMPLATE } from './rigs.js';

/** UV検証用のシャツ: 各面に色と文字(F/B/L/R/T/U)を描く */
function makeUvTestCanvas() {
  const c = document.createElement('canvas');
  c.width = TEMPLATE.w; c.height = TEMPLATE.h;
  const g = c.getContext('2d');
  const label = { front: 'F', back: 'B', left: 'L', right: 'R', top: 'T', bottom: 'U' };
  const colors = { front: '#2e7dd7', back: '#d9534f', left: '#3fae5a', right: '#e0a030', top: '#8e5fc9', bottom: '#555' };
  for (const set of Object.values(CLOTH_RECTS)) {
    for (const [face, r] of Object.entries(set)) {
      g.fillStyle = colors[face]; g.fillRect(r[0], r[1], r[2], r[3]);
      g.strokeStyle = '#fff'; g.lineWidth = 2; g.strokeRect(r[0] + 1, r[1] + 1, r[2] - 2, r[3] - 2);
      g.fillStyle = '#fff'; g.font = `bold ${Math.min(r[2], r[3]) * 0.6}px sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(label[face], r[0] + r[2] / 2, r[1] + r[3] / 2);
    }
  }
  return c;
}

function makeShirtCanvas(base, stripe) {
  const c = document.createElement('canvas');
  c.width = TEMPLATE.w; c.height = TEMPLATE.h;
  const g = c.getContext('2d');
  const paint = (r) => {
    g.fillStyle = base; g.fillRect(r[0], r[1], r[2], r[3]);
    g.fillStyle = stripe; g.fillRect(r[0], r[1] + r[3] * 0.42, r[2], r[3] * 0.14);
  };
  const T = CLOTH_RECTS.torso;
  for (const k of ['front', 'back', 'left', 'right']) paint(T[k]);
  for (const set of [CLOTH_RECTS.rLimb, CLOTH_RECTS.lLimb]) {
    for (const k of ['front', 'back', 'left', 'right']) {
      const r = set[k];
      g.fillStyle = base; g.fillRect(r[0], r[1], r[2], r[3] * 0.62); // 袖: 上62%だけ(下は素肌)
    }
  }
  return c;
}

function makePantsCanvas(color) {
  const c = document.createElement('canvas');
  c.width = TEMPLATE.w; c.height = TEMPLATE.h;
  const g = c.getContext('2d');
  g.fillStyle = color;
  const T = CLOTH_RECTS.torso;
  for (const k of ['front', 'back', 'left', 'right']) g.fillRect(T[k][0], T[k][1] + T[k][3] * 0.72, T[k][2], T[k][3] * 0.28);
  for (const set of [CLOTH_RECTS.rLimb, CLOTH_RECTS.lLimb]) {
    for (const k of ['front', 'back', 'left', 'right']) g.fillRect(set[k][0], set[k][1], set[k][2], set[k][3] * 0.85);
  }
  return c;
}

/** 箱メッシュ(アクセサリ配置の確認用)。中心が原点。 */
function boxGeometry(sx, sy, sz) {
  const x = sx / 2, y = sy / 2, z = sz / 2;
  const faces = [ // [法線, 4頂点]
    [[1, 0, 0], [[x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z]]], [[-1, 0, 0], [[-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]]],
    [[0, 1, 0], [[-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]]], [[0, -1, 0], [[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]]],
    [[0, 0, 1], [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]]], [[0, 0, -1], [[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]]],
  ];
  const positions = [], normals = [], uvs = [], indices = [];
  faces.forEach(([n, vs], f) => {
    vs.forEach((v, i) => { positions.push(...v); normals.push(...n); uvs.push(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 0 : 1); });
    indices.push(f * 4, f * 4 + 1, f * 4 + 2, f * 4, f * 4 + 2, f * 4 + 3);
  });
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices), bbox: { min: [-x, -y, -z], max: [x, y, z] } };
}
const demoHat = (color) => ({ name: 'デモの帽子', geometry: boxGeometry(1.5, 0.6, 1.5), texture: null,
  handle: { kind: 'meshpart', size: [1.5, 0.6, 1.5], color, transparency: 0, scale: [1, 1, 1], offset: [0, 0, 0] },
  attachment: { name: 'HatAttachment', pos: [0, -0.3, 0], rot: [1, 0, 0, 0, 1, 0, 0, 0, 1] } });

const SKIN = '#EAB892';
const base = (rigType) => ({ rigType, scales: { ...DEFAULT_SCALES }, face: null, accessories: [], report: [] });

export const DEMOS = [
  { id: 'demo-r6', label: 'ゲスト R6', make: () => ({ ...base('R6'),
    colors: { head: SKIN, torso: '#0D69AC', leftArm: SKIN, rightArm: SKIN, leftLeg: '#4B974B', rightLeg: '#4B974B' },
    clothing: {} }) },
  { id: 'demo-r15', label: 'ゲスト R15', make: () => ({ ...base('R15'),
    colors: { head: '#CC8E69', torso: '#C4281C', leftArm: '#CC8E69', rightArm: '#CC8E69', leftLeg: '#27462D', rightLeg: '#27462D' },
    clothing: {} }) },
  { id: 'demo-clothes', label: '服つき R6', make: () => ({ ...base('R6'),
    colors: { head: SKIN, torso: SKIN, leftArm: SKIN, rightArm: SKIN, leftLeg: SKIN, rightLeg: SKIN },
    clothing: { shirt: makeShirtCanvas('#d9534f', '#f5f5f5'), pants: makePantsCanvas('#2b3a67') } }) },
  { id: 'demo-uv', label: 'UVテスト', make: () => ({ ...base('R6'),
    colors: { head: SKIN, torso: SKIN, leftArm: SKIN, rightArm: SKIN, leftLeg: SKIN, rightLeg: SKIN },
    clothing: { shirt: makeUvTestCanvas(), pants: makeUvTestCanvas() } }) },
  { id: 'demo-hat-r6', label: '帽子つき R6', make: () => ({ ...base('R6'),
    colors: { head: SKIN, torso: '#6B327C', leftArm: SKIN, rightArm: SKIN, leftLeg: '#635F62', rightLeg: '#635F62' },
    clothing: {}, accessories: [demoHat([0.85, 0.2, 0.2])] }) },
  { id: 'demo-hat-r15', label: '帽子つき R15', make: () => ({ ...base('R15'),
    colors: { head: SKIN, torso: '#287F47', leftArm: SKIN, rightArm: SKIN, leftLeg: '#635F62', rightLeg: '#635F62' },
    clothing: {}, accessories: [demoHat([0.2, 0.45, 0.85])] }) },
  { id: 'demo-r15-clothes', label: '服つき R15', make: () => ({ ...base('R15'),
    colors: { head: SKIN, torso: SKIN, leftArm: SKIN, rightArm: SKIN, leftLeg: SKIN, rightLeg: SKIN },
    clothing: { shirt: makeShirtCanvas('#3fae5a', '#f5f5f5'), pants: makePantsCanvas('#333a4d') } }) },
];

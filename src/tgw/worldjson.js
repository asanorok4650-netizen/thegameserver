// rbxlのパース済みツリー → world.json(THREE非依存。Studio・変換・Worker・テストで共通に使う)
// 仕様: tgw-spec-v0.1 §4 / §9
import { nameOf } from '../rbx/rbxm.js';
import { brickHex } from '../avatar/rigs.js';

export const WORLD_FORMAT_VERSION = '1.0';

const SKIP_ROOTS = new Set(['StarterPlayer', 'StarterGui', 'StarterPack', 'ReplicatedStorage', 'ServerStorage',
  'ServerScriptService', 'ReplicatedFirst', 'Lighting', 'SoundService', 'Players', 'Teams', 'Chat']);
const APPROX = new Set(['MeshPart', 'UnionOperation', 'TrussPart']); // 形をSizeの箱で代用するもの
const SCRIPTS = new Set(['Script', 'LocalScript', 'ModuleScript']);

export function shapeOf(inst) {
  const c = inst.className, p = inst.props;
  if (c === 'WedgePart') return 'wedge';
  if (c === 'CornerWedgePart') return 'corner';
  const s = p.shape !== undefined ? p.shape : p.Shape;
  return s === 0 ? 'ball' : s === 2 ? 'cylinder' : s === 3 ? 'wedge' : s === 4 ? 'corner' : 'block';
}

const hex2 = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');

/** パーツの色 → '#rrggbb'(sRGB) */
export function colorHexOf(p) {
  const c = p.Color3uint8 || p.Color3 || p.Color;
  if (Array.isArray(c) && c.length === 3) {
    const bytes = c.some((v) => v > 1.0001) ? c : c.map((v) => v * 255);
    return '#' + bytes.map(hex2).join('');
  }
  return String(brickHex(p.BrickColor)).toLowerCase();
}

/**
 * @returns { worldJson, report: { parts, approx:{クラス:数}, ignored:{クラス:数}, spawnFound } }
 * report の approx / ignored は manifest.source にそのまま入れる(Studioが「何が落ちたか」を表示する元)。
 */
export function treeToWorldJson(tree, log = () => {}) {
  const ignored = {}, approx = {};
  const ws = [...tree.instances.values()].find((i) => i.className === 'Workspace');
  const stack = ws ? [...ws.children] : tree.roots.filter((r) => !SKIP_ROOTS.has(r.className));
  if (!ws) log('warn', 'Workspaceが見つからないため、ルート直下のパーツを使います');

  const nodes = [];
  while (stack.length) {
    const n = stack.pop();
    if (n.className === 'Terrain') { ignored.Terrain = (ignored.Terrain || 0) + 1; continue; }
    if (SCRIPTS.has(n.className)) ignored[n.className] = (ignored[n.className] || 0) + 1;
    if (SKIP_ROOTS.has(n.className)) continue;
    const size = n.props.Size || n.props.size, cf = n.props.CFrame;
    if (Array.isArray(size) && cf && cf.pos && cf.rot) nodes.push(n);
    for (const c of n.children) stack.push(c);
  }

  const parts = [], spawns = [];
  for (const n of nodes) {
    const p = n.props, size = p.Size || p.size, cf = p.CFrame;
    const [sx, sy, sz] = size;
    if (!(sx > 0 && sy > 0 && sz > 0)) continue;
    const part = {
      id: 'p' + (parts.length + 1),
      name: String(nameOf(n)),
      shape: shapeOf(n),
      size: [sx, sy, sz],
      pos: [cf.pos[0], cf.pos[1], cf.pos[2]],
      rot: Array.from(cf.rot).slice(0, 9),
      color: colorHexOf(p),
      transparency: Math.min(1, Math.max(0, Number(p.Transparency) || 0)),
      collide: p.CanCollide !== false,
      tags: [],   // TODO: rbxパーサがTags/Attributesを返せるようになったら取り込む(仕様§11)
      attrs: {}
    };
    if (APPROX.has(n.className)) { part.approx = true; approx[n.className] = (approx[n.className] || 0) + 1; }
    parts.push(part);
    if (n.className === 'SpawnLocation') spawns.push({ pos: part.pos.slice(), size: part.size.slice() });
  }

  const worldJson = { formatVersion: WORLD_FORMAT_VERSION, units: 'studs', up: '+Y', spawns, parts };
  return { worldJson, report: { parts: parts.length, approx, ignored, spawnFound: spawns.length > 0 } };
}

/** パーツ全体のAABB(manifest.world.bounds用)。回転は無視せず、回転後の半径で見積もる */
export function worldBounds(worldJson) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of worldJson.parts) {
    for (let a = 0; a < 3; a++) {
      const h = Math.abs(p.rot[a * 3]) * p.size[0] / 2 + Math.abs(p.rot[a * 3 + 1]) * p.size[1] / 2 + Math.abs(p.rot[a * 3 + 2]) * p.size[2] / 2;
      min[a] = Math.min(min[a], p.pos[a] - h);
      max[a] = Math.max(max[a], p.pos[a] + h);
    }
  }
  return worldJson.parts.length ? { min, max } : { min: [0, 0, 0], max: [0, 0, 0] };
}

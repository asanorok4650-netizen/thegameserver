// パース済みツリー(Workspace)→ THREEのシーン + 衝突データ。
// 同じ形・同じ透明度のパーツは InstancedMesh にまとめて描画コールを減らす(スマホ向け)。
import * as THREE from 'three';
import { primitiveGeometry, MESH_TYPE } from '../rbx/primitives.js';
import { brickHex } from '../avatar/rigs.js';
import { CollisionWorld, wedgePlanes, cornerPlanes } from './collision.js';

const SKIP_ROOTS = new Set(['StarterPlayer', 'StarterGui', 'StarterPack', 'ReplicatedStorage', 'ServerStorage',
  'ServerScriptService', 'ReplicatedFirst', 'Lighting', 'SoundService', 'Players', 'Teams', 'Chat']);
const APPROX = new Set(['MeshPart', 'UnionOperation', 'TrussPart']); // 形をSizeの箱で代用するもの

function shapeOf(inst) {
  const c = inst.className, p = inst.props;
  if (c === 'WedgePart') return 'wedge';
  if (c === 'CornerWedgePart') return 'corner';
  const s = p.shape !== undefined ? p.shape : p.Shape;
  return s === 0 ? 'ball' : s === 2 ? 'cylinder' : s === 3 ? 'wedge' : s === 4 ? 'corner' : 'block';
}

function toGeometry(g) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(g.normals, 3));
  geo.setIndex(new THREE.BufferAttribute(g.indices, 1));
  return geo;
}

function unitGeometry(shape) {
  switch (shape) {
    case 'ball': return new THREE.SphereGeometry(0.5, 20, 14);
    case 'cylinder': { const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 24); g.rotateZ(Math.PI / 2); return g; } // 軸はX方向(Robloxと同じ)
    case 'wedge': return toGeometry(primitiveGeometry(MESH_TYPE.Wedge, [1, 1, 1]));
    case 'corner': return toGeometry(primitiveGeometry(MESH_TYPE.CornerWedge, [1, 1, 1]));
    default: return new THREE.BoxGeometry(1, 1, 1);
  }
}

function colorOf(p) {
  const c = p.Color3uint8 || p.Color3 || p.Color;
  if (Array.isArray(c) && c.length === 3) {
    const f = c.some((v) => v > 1.0001) ? c.map((v) => v / 255) : c;
    return new THREE.Color().setRGB(f[0], f[1], f[2], THREE.SRGBColorSpace);
  }
  return new THREE.Color(brickHex(p.BrickColor));
}

/** @returns { group, collision, spawn:[x,y,z], stats } */
export function buildWorld(tree, log = () => {}) {
  const stats = { parts: 0, drawn: 0, collidable: 0, approx: {}, ignored: {}, spawnFound: false };
  const ws = [...tree.instances.values()].find((i) => i.className === 'Workspace');
  const stack = ws ? [...ws.children] : tree.roots.filter((r) => !SKIP_ROOTS.has(r.className));
  if (!ws) log('warn', 'Workspaceが見つからないため、ルート直下のパーツを使います');

  const parts = [];
  while (stack.length) {
    const n = stack.pop();
    if (n.className === 'Terrain') { stats.ignored.Terrain = (stats.ignored.Terrain || 0) + 1; continue; }
    if (SKIP_ROOTS.has(n.className)) continue;
    const size = n.props.Size || n.props.size, cf = n.props.CFrame;
    if (Array.isArray(size) && cf && cf.pos && cf.rot) parts.push(n);
    for (const c of n.children) stack.push(c);
  }
  stats.parts = parts.length;

  const buckets = new Map(); // shape|transparency → { shape, t, list:[{matrix,color}] }
  const collision = new CollisionWorld();
  const spawns = [];

  for (const n of parts) {
    const p = n.props, size = p.Size || p.size, cf = p.CFrame;
    const [sx, sy, sz] = size, m = cf.rot, pos = cf.pos;
    if (!(sx > 0 && sy > 0 && sz > 0)) continue;
    if (APPROX.has(n.className)) stats.approx[n.className] = (stats.approx[n.className] || 0) + 1;
    const shape = shapeOf(n);
    const t = Math.min(1, Math.max(0, Number(p.Transparency) || 0));

    if (t < 0.99) {
      const key = shape + '|' + Math.round(t * 10);
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { shape, t: Math.round(t * 10) / 10, list: [] }));
      const mat = new THREE.Matrix4().set(m[0], m[1], m[2], pos[0], m[3], m[4], m[5], pos[1], m[6], m[7], m[8], pos[2], 0, 0, 0, 1);
      mat.multiply(new THREE.Matrix4().makeScale(sx, sy, sz));
      b.list.push({ matrix: mat, color: colorOf(p) });
    }

    if (p.CanCollide !== false) {
      const base = { pos: pos.slice(), rot: m.slice(), half: [sx / 2, sy / 2, sz / 2] };
      if (shape === 'ball') collision.add({ ...base, type: 'ball', radius: sx / 2 });
      else if (shape === 'wedge') collision.add({ ...base, type: 'convex', planes: wedgePlanes([sx, sy, sz]) });
      else if (shape === 'corner') collision.add({ ...base, type: 'convex', planes: cornerPlanes([sx, sy, sz]) });
      else collision.add({ ...base, type: 'box' });
      stats.collidable++;
    }
    if (n.className === 'SpawnLocation') spawns.push({ pos, size });
  }

  const group = new THREE.Group();
  group.name = 'World';
  for (const b of buckets.values()) {
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: b.t > 0, opacity: 1 - b.t, depthWrite: b.t === 0 });
    const mesh = new THREE.InstancedMesh(unitGeometry(b.shape), mat, b.list.length);
    b.list.forEach((it, i) => { mesh.setMatrixAt(i, it.matrix); mesh.setColorAt(i, it.color); });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false; // インスタンス全体の境界球が巨大になるため
    group.add(mesh);
    stats.drawn += b.list.length;
  }

  // スポーン位置: SpawnLocation の上 → なければ原点の真上の地面 → なければ全体の上空
  let spawn;
  if (spawns.length) {
    const s = spawns[0];
    spawn = [s.pos[0], s.pos[1] + s.size[1] / 2 + 0.2, s.pos[2]];
    stats.spawnFound = true;
  } else {
    const top = collision.highestTopAt(0, 0), b = collision.bounds();
    spawn = top !== null ? [0, top + 0.2, 0] : b ? [(b.min[0] + b.max[0]) / 2, b.max[1] + 10, (b.min[2] + b.max[2]) / 2] : [0, 10, 0];
  }
  return { group, collision, spawn, stats };
}

export function disposeWorld(world) {
  world.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); if (o.dispose && o.isInstancedMesh) o.dispose(); });
}

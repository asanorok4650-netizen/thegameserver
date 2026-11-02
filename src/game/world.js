// world.json → THREEのシーン + 衝突データ。
// 同じ形・同じ透明度のパーツは InstancedMesh にまとめて描画コールを減らす(スマホ向け)。
import * as THREE from 'three';
import { primitiveGeometry, MESH_TYPE } from '../rbx/primitives.js';
import { CollisionWorld, wedgePlanes, cornerPlanes } from './collision.js';
import { treeToWorldJson } from '../tgw/worldjson.js';
import { resolveBehavior, isMotion } from '../behaviors/index.js';
import { Dynamics } from './dynamics.js';
import { resolveEnvironment } from './rules.js';

function toGeometry(g) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(g.normals, 3));
  geo.setIndex(new THREE.BufferAttribute(g.indices, 1));
  return geo;
}

export function unitGeometry(shape) {
  switch (shape) {
    case 'ball': return new THREE.SphereGeometry(0.5, 20, 14);
    case 'cylinder': { const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 24); g.rotateZ(Math.PI / 2); return g; }
    case 'wedge': return toGeometry(primitiveGeometry(MESH_TYPE.Wedge, [1, 1, 1]));
    case 'corner': return toGeometry(primitiveGeometry(MESH_TYPE.CornerWedge, [1, 1, 1]));
    default: return new THREE.BoxGeometry(1, 1, 1);
  }
}

export function buildSceneFromWorld(worldJson) {
  const stats = { parts: worldJson.parts.length, drawn: 0, collidable: 0, triggers: 0, spawnFound: false, dynamic: 0, effects: 0 };
  const buckets = new Map();
  const collision = new CollisionWorld();
  const triggers = [];
  const ruleTriggers = [];
  const dynamics = new Dynamics(collision);
  const slots = new Map(); // partId → { key, i }(動くパーツの見た目を更新するため)
  const pending = [];
  const partRecords = new Map();

  for (const p of worldJson.parts) {
    const [sx, sy, sz] = p.size, m = p.rot, pos = p.pos;
    const shape = p.shape;
    const t = Math.min(1, Math.max(0, Number(p.transparency) || 0));

    if (t < 0.99) {
      const key = shape + '|' + Math.round(t * 10);
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { key, shape, t: Math.round(t * 10) / 10, list: [] }));
      const mat = new THREE.Matrix4().set(m[0], m[1], m[2], pos[0], m[3], m[4], m[5], pos[1], m[6], m[7], m[8], pos[2], 0, 0, 0, 1);
      mat.multiply(new THREE.Matrix4().makeScale(sx, sy, sz));
      slots.set(p.id, { key, i: b.list.length });
      b.list.push({ matrix: mat, color: new THREE.Color(p.color) });
    }

    const ruleTrigger = { id: p.id, name: p.name, tags: [], pos: pos.slice(), rot: m.slice(), half: [sx / 2, sy / 2, sz / 2], size: [sx, sy, sz] };
    ruleTriggers.push(ruleTrigger);
    const behavior = resolveBehavior(p.attrs);
    const tags = Array.isArray(p.tags) ? p.tags.filter((tag) => typeof tag === 'string' && tag) : [];
    let trigger = null;
    if (tags.length) {
      trigger = { id: p.id, name: p.name, tags, pos: pos.slice(), rot: m.slice(), half: [sx / 2, sy / 2, sz / 2] };
      triggers.push(trigger);
      stats.triggers++;
    }
    let item = null;

    if (p.collide) {
      const base = { pos: pos.slice(), rot: m.slice(), half: [sx / 2, sy / 2, sz / 2] };
      if (shape === 'ball') item = { ...base, type: 'ball', radius: sx / 2 };
      else if (shape === 'wedge') item = { ...base, type: 'convex', planes: wedgePlanes([sx, sy, sz]) };
      else if (shape === 'corner') item = { ...base, type: 'convex', planes: cornerPlanes([sx, sy, sz]) };
      else item = { ...base, type: 'box' };
      if (behavior && behavior.id === 'bounce') { item.effect = { type: 'bounce', power: behavior.params.power }; stats.effects++; }
      if (behavior && behavior.id === 'conveyor') { item.effect = { type: 'conveyor', speed: behavior.params.speed }; stats.effects++; }
      collision.add(item);
      stats.collidable++;
    }
    let entry = null;
    if (isMotion(behavior)) {
      entry = dynamics.add({ base: { pos: pos.slice(), rot: m.slice() }, behavior, item, trigger: ruleTrigger, size: [sx, sy, sz], id: p.id });
      pending.push(entry);
      stats.dynamic++;
    }
    partRecords.set(p.id, { id: p.id, name: p.name, size: [sx, sy, sz], pos: pos.slice(), rot: m.slice(), visible: t < 0.99, item, trigger: ruleTrigger, entry });
  }

  const group = new THREE.Group();
  group.name = 'World';
  const meshes = new Map();
  for (const b of buckets.values()) {
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: b.t > 0, opacity: 1 - b.t, depthWrite: b.t === 0 });
    const mesh = new THREE.InstancedMesh(unitGeometry(b.shape), mat, b.list.length);
    b.list.forEach((it, i) => { mesh.setMatrixAt(i, it.matrix); mesh.setColorAt(i, it.color); });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    group.add(mesh);
    meshes.set(b.key, mesh);
    stats.drawn += b.list.length;
  }
  const tmp = new THREE.Matrix4(), scl = new THREE.Matrix4();
  const applyPartMatrix = (record) => {
    const slot = slots.get(record.id);
    if (!slot) return;
    const mesh = meshes.get(slot.key);
    const q = record.pos, r = record.rot;
    tmp.set(r[0], r[1], r[2], q[0], r[3], r[4], r[5], q[1], r[6], r[7], r[8], q[2], 0, 0, 0, 1);
    tmp.multiply(scl.makeScale(record.visible ? record.size[0] : 0, record.visible ? record.size[1] : 0, record.visible ? record.size[2] : 0));
    mesh.setMatrixAt(slot.i, tmp);
    mesh.instanceMatrix.needsUpdate = true;
  };
  for (const e of pending) {
    const record = partRecords.get(e.id);
    e.apply = (pose) => {
      record.pos = pose.pos.slice();
      record.rot = pose.rot.slice();
      applyPartMatrix(record);
    };
  }
  const findRecord = (key) => [...partRecords.values()].find((p) => p.id === key || p.name === key);
  const setPartVisible = (key, visible) => {
    const record = findRecord(key);
    if (!record) return false;
    const nextVisible = !!visible;
    if (record.visible !== nextVisible && record.item) {
      if (nextVisible) collision.add(record.item); else collision.remove(record.item);
    }
    record.visible = nextVisible;
    record.trigger.enabled = nextVisible;
    applyPartMatrix(record);
    return true;
  };
  const movePart = (key, position) => {
    const record = findRecord(key);
    if (!record || !Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite)) return false;
    record.pos = position.map((v) => Math.max(-100000, Math.min(100000, v)));
    record.trigger.pos = record.pos.slice();
    if (record.entry) {
      record.entry.base.pos = record.pos.slice();
      record.entry.pose = { pos: record.pos.slice(), rot: record.rot.slice() };
    }
    if (record.item) collision.moveItem(record.item, record.pos, record.rot);
    applyPartMatrix(record);
    return true;
  };

  let spawn;
  const spawns = worldJson.spawns || [];
  if (spawns.length) {
    const s = spawns[0];
    spawn = [s.pos[0], s.pos[1] + s.size[1] / 2 + 0.2, s.pos[2]];
    stats.spawnFound = true;
  } else {
    const top = collision.highestTopAt(0, 0), b = collision.bounds();
    spawn = top !== null ? [0, top + 0.2, 0] : b ? [(b.min[0] + b.max[0]) / 2, b.max[1] + 10, (b.min[2] + b.max[2]) / 2] : [0, 10, 0];
  }
  return { group, collision, triggers, ruleTriggers, ruleParts: ruleTriggers, dynamics, setPartVisible, movePart, environment: resolveEnvironment(worldJson.environment), spawn, stats };
}

export function buildWorld(tree, log = () => {}) {
  const { worldJson, report } = treeToWorldJson(tree, log);
  const world = buildSceneFromWorld(worldJson);
  world.stats.approx = report.approx;
  world.stats.ignored = report.ignored;
  return world;
}

export function disposeWorld(world) {
  world.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); if (o.dispose && o.isInstancedMesh) o.dispose(); });
}

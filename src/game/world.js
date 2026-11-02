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

    if (t < 0.999) {
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

    {
      const base = { pos: pos.slice(), rot: m.slice(), half: [sx / 2, sy / 2, sz / 2] };
      if (shape === 'ball') item = { ...base, type: 'ball', radius: Math.max(sx, sy, sz) / 2 };
      else if (shape === 'wedge') item = { ...base, type: 'convex', planes: wedgePlanes([sx, sy, sz]) };
      else if (shape === 'corner') item = { ...base, type: 'convex', planes: cornerPlanes([sx, sy, sz]) };
      else item = { ...base, type: 'box' };
      if (behavior && behavior.id === 'bounce') { item.effect = { type: 'bounce', power: behavior.params.power }; stats.effects++; }
      if (behavior && behavior.id === 'conveyor') { item.effect = { type: 'conveyor', speed: behavior.params.speed }; stats.effects++; }
      if (p.collide) { collision.add(item); stats.collidable++; }
    }
    let entry = null;
    if (isMotion(behavior)) {
      entry = dynamics.add({ base: { pos: pos.slice(), rot: m.slice() }, behavior, item, trigger: ruleTrigger, size: [sx, sy, sz], id: p.id });
      pending.push(entry);
      stats.dynamic++;
    }
    partRecords.set(p.id, { id: p.id, name: p.name, shape, color: p.color, transparency: t, collide: !!p.collide, size: [sx, sy, sz], pos: pos.slice(), rot: m.slice(), visible: true, item, trigger: ruleTrigger, tagTrigger: trigger, entry, dynamicMesh: null });
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
  const matrixFor = (record) => {
    const q = record.pos, r = record.rot;
    tmp.set(r[0], r[1], r[2], q[0], r[3], r[4], r[5], q[1], r[6], r[7], r[8], q[2], 0, 0, 0, 1);
    tmp.multiply(scl.makeScale(record.visible ? record.size[0] : 0, record.visible ? record.size[1] : 0, record.visible ? record.size[2] : 0));
    return tmp;
  };
  const applyPartMatrix = (record) => {
    const slot = slots.get(record.id);
    if (slot && !record.dynamicMesh) {
      const mesh = meshes.get(slot.key);
      mesh.setMatrixAt(slot.i, matrixFor(record));
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (record.dynamicMesh) record.dynamicMesh.matrix.copy(matrixFor(record));
  };
  const ensureDynamicMesh = (record) => {
    if (record.dynamicMesh) return record.dynamicMesh;
    const slot = slots.get(record.id);
    if (slot) {
      const mesh = meshes.get(slot.key);
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      mesh.setMatrixAt(slot.i, zero);
      mesh.instanceMatrix.needsUpdate = true;
    }
    const material = new THREE.MeshLambertMaterial({ color: record.color, transparent: record.transparency > 0, opacity: 1 - record.transparency, depthWrite: record.transparency === 0 });
    const mesh = new THREE.Mesh(unitGeometry(record.shape), material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(matrixFor(record));
    group.add(mesh);
    record.dynamicMesh = mesh;
    return mesh;
  };
  for (const e of pending) {
    const record = partRecords.get(e.id);
    e.apply = (pose) => {
      record.pos = pose.pos.slice();
      record.rot = pose.rot.slice();
      if (record.tagTrigger) { record.tagTrigger.pos = record.pos.slice(); record.tagTrigger.rot = record.rot.slice(); }
      applyPartMatrix(record);
    };
  }
  const findRecord = (key) => {
    const exact = partRecords.get(key);
    if (exact) return exact;
    const matches = [...partRecords.values()].filter((p) => p.name === key);
    return matches.length === 1 ? matches[0] : null;
  };
  const setPartVisible = (key, visible) => {
    const record = findRecord(key);
    if (!record) return false;
    const nextVisible = !!visible;
    if (record.visible !== nextVisible && record.item && record.collide) {
      if (nextVisible) collision.add(record.item); else collision.remove(record.item);
    }
    record.visible = nextVisible;
    record.trigger.enabled = nextVisible;
    if (record.tagTrigger) record.tagTrigger.enabled = nextVisible;
    applyPartMatrix(record);
    return true;
  };
  const movePart = (key, position) => {
    const record = findRecord(key);
    if (!record || !Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite)) return false;
    record.pos = position.map((v) => Math.max(-100000, Math.min(100000, v)));
    record.trigger.pos = record.pos.slice();
    if (record.tagTrigger) record.tagTrigger.pos = record.pos.slice();
    if (record.entry) {
      record.entry.base.pos = record.pos.slice();
      record.entry.pose = { pos: record.pos.slice(), rot: record.rot.slice() };
    }
    if (record.item) collision.moveItem(record.item, record.pos, record.rot);
    applyPartMatrix(record);
    return true;
  };

  const setPartProperty = (key, property, value) => {
    const record = findRecord(key);
    if (!record) return false;
    const finiteVector = Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === 'number' && Number.isFinite(v));
    if (property === 'color') {
      if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) return false;
      record.color = value.toLowerCase();
      const slot = slots.get(record.id);
      if (slot) { const mesh = meshes.get(slot.key); mesh.setColorAt(slot.i, new THREE.Color(record.color)); if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
      if (record.dynamicMesh) record.dynamicMesh.material.color.set(record.color);
      return true;
    }
    if (property === 'size') {
      if (!finiteVector || value.some((v) => v < 0.1 || v > 1000)) return false;
      if (record.collide && record.visible && record.item) collision.remove(record.item);
      record.size = value.slice();
      record.trigger.size = value.slice(); record.trigger.half = value.map((v) => v / 2);
      if (record.tagTrigger) record.tagTrigger.half = value.map((v) => v / 2);
      if (record.item) {
        record.item.half = value.map((v) => v / 2);
        if (record.item.type === 'ball') record.item.radius = Math.max(...value) / 2;
        if (record.item.type === 'convex') record.item.planes = record.shape === 'wedge' ? wedgePlanes(value) : cornerPlanes(value);
        if (record.collide && record.visible) collision.add(record.item);
      }
      if (record.entry) record.entry.size = value.slice();
      applyPartMatrix(record);
      return true;
    }
    if (property === 'position') {
      if (!finiteVector || value.some((v) => Math.abs(v) > 100000)) return false;
      record.pos = value.slice(); record.trigger.pos = record.pos.slice();
      if (record.tagTrigger) record.tagTrigger.pos = record.pos.slice();
      if (record.entry) { record.entry.base.pos = record.pos.slice(); record.entry.pose.pos = record.pos.slice(); }
      if (record.item && record.collide && record.visible) collision.moveItem(record.item, record.pos, record.rot);
      applyPartMatrix(record);
      return true;
    }
    if (property === 'rotation') {
      if (!finiteVector || value.some((v) => Math.abs(v) > 36000)) return false;
      const euler = new THREE.Euler(value[0] * Math.PI / 180, value[1] * Math.PI / 180, value[2] * Math.PI / 180, 'XYZ');
      const matrix = new THREE.Matrix4().makeRotationFromEuler(euler).elements;
      record.rot = [matrix[0], matrix[4], matrix[8], matrix[1], matrix[5], matrix[9], matrix[2], matrix[6], matrix[10]];
      record.trigger.rot = record.rot.slice();
      if (record.tagTrigger) record.tagTrigger.rot = record.rot.slice();
      if (record.entry) { record.entry.base.rot = record.rot.slice(); record.entry.pose.rot = record.rot.slice(); }
      if (record.item && record.collide && record.visible) collision.moveItem(record.item, record.pos, record.rot);
      applyPartMatrix(record);
      return true;
    }
    if (property === 'transparency') {
      if (typeof value !== 'number' || !Number.isFinite(value)) return false;
      record.transparency = Math.max(0, Math.min(1, value));
      const mesh = ensureDynamicMesh(record);
      mesh.material.opacity = 1 - record.transparency;
      mesh.material.transparent = record.transparency > 0;
      mesh.material.depthWrite = record.transparency === 0;
      mesh.material.needsUpdate = true;
      return true;
    }
    if (property === 'collide') {
      const next = !!value;
      if (record.collide !== next && record.item) {
        if (next && record.visible) collision.add(record.item); else collision.remove(record.item);
      }
      record.collide = next;
      return true;
    }
    return false;
  };
  const getPartProperty = (key, property) => {
    const record = findRecord(key);
    if (!record) return null;
    if (property === 'color') return record.color;
    if (property === 'collide') return record.collide;
    if (property === 'transparency') return record.transparency;
    const axis = { X: 0, Y: 1, Z: 2 };
    if (property.startsWith('size')) return record.size[axis[property.slice(-1).toUpperCase()]];
    if (property.startsWith('position')) return record.pos[axis[property.slice(-1).toUpperCase()]];
    if (property.startsWith('rotation')) {
      const m = new THREE.Matrix4().set(record.rot[0], record.rot[1], record.rot[2], 0, record.rot[3], record.rot[4], record.rot[5], 0, record.rot[6], record.rot[7], record.rot[8], 0, 0, 0, 0, 1);
      const e = new THREE.Euler().setFromRotationMatrix(m, 'XYZ');
      return ({ rotationX: e.x, rotationY: e.y, rotationZ: e.z })[property] * 180 / Math.PI;
    }
    return null;
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
  return { group, collision, triggers, ruleTriggers, ruleParts: ruleTriggers, dynamics, setPartVisible, movePart, setPartProperty, getPartProperty, environment: resolveEnvironment(worldJson.environment), spawn, stats };
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

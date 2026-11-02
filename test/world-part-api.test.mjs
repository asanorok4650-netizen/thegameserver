import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSceneFromWorld } from '../src/game/world.js';

const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const part = (id, name, extra = {}) => ({
  id, name, pos: [0, 2, 0], rot: identity.slice(), size: [4, 1, 2],
  shape: 'box', color: '#ff0000', transparency: 0, collide: true,
  attrs: {}, tags: [], ...extra
});

test('world part API reads and updates color, size, position, rotation, transparency and collision', () => {
  const world = buildSceneFromWorld({
    parts: [part('part-1', 'Block')],
    spawns: [],
    environment: {}
  });
  assert.equal(world.getPartProperty('part-1', 'color'), '#ff0000');
  assert.equal(world.getPartProperty('part-1', 'collide'), true);
  assert.equal(world.collision.items.length, 1);

  assert.equal(world.setPartProperty('part-1', 'color', '#00aaff'), true);
  assert.equal(world.getPartProperty('part-1', 'color'), '#00aaff');
  assert.equal(world.setPartProperty('part-1', 'size', [8, 2, 4]), true);
  assert.equal(world.getPartProperty('part-1', 'sizeX'), 8);
  assert.deepEqual(world.collision.items[0].half, [4, 1, 2]);

  assert.equal(world.setPartProperty('part-1', 'position', [10, 20, 30]), true);
  assert.equal(world.getPartProperty('part-1', 'positionY'), 20);
  assert.deepEqual(world.collision.items[0].pos, [10, 20, 30]);

  assert.equal(world.setPartProperty('part-1', 'rotation', [0, 90, 0]), true);
  assert.ok(Math.abs(world.getPartProperty('part-1', 'rotationY') - 90) < 1e-6);

  assert.equal(world.setPartProperty('part-1', 'transparency', 0.4), true);
  assert.equal(world.getPartProperty('part-1', 'transparency'), 0.4);
  assert.ok(world.group.children.some((child) => child.isMesh && !child.isInstancedMesh));

  assert.equal(world.setPartProperty('part-1', 'collide', false), true);
  assert.equal(world.getPartProperty('part-1', 'collide'), false);
  assert.equal(world.collision.items.length, 0);
  assert.equal(world.setPartProperty('part-1', 'collide', true), true);
  assert.equal(world.collision.items.length, 1);
});

test('world part API rejects invalid values and ambiguous name lookups', () => {
  const world = buildSceneFromWorld({
    parts: [part('part-1', 'Duplicate'), part('part-2', 'Duplicate')],
    spawns: [],
    environment: {}
  });
  assert.equal(world.setPartProperty('Duplicate', 'color', '#ffffff'), false);
  assert.equal(world.getPartProperty('Duplicate', 'color'), null);
  assert.equal(world.setPartProperty('part-1', 'color', 'red'), false);
  assert.equal(world.setPartProperty('part-1', 'size', [0, 1, 1]), false);
  assert.equal(world.setPartProperty('part-1', 'position', [Infinity, 0, 0]), false);
  assert.equal(world.setPartProperty('part-1', 'transparency', 2), true);
  assert.equal(world.getPartProperty('part-1', 'transparency'), 1);
});

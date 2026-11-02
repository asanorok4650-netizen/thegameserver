import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Game } from '../src/game/engine.js';
import { compileBlocklyWorkspace } from '../src/scripting/compiler.js';
import { createBlocklyRuntime } from '../src/scripting/runtime.js';

const value = (type, fields = {}) => ({ type, fields, inputs: {} });
const statement = (type, fields = {}, inputs = {}, next = null) => ({ type, fields, inputs, ...(next ? { next: { block: next } } : {}) });
const start = (first) => ({ blocks: { blocks: [statement('rbxl_when_start', {}, {}, first)] } });

test('M1-D compiler builds player get/set, damage, heal, teleport and respawn IR', () => {
  const blocks = [
    statement('rbxl_player_set_health', { PLAYER: 'local', VALUE: 80 }),
    statement('rbxl_player_set_position', { PLAYER: 'local', X: 1, Y: 5, Z: 3 }),
    statement('rbxl_player_set_walk_speed', { PLAYER: 'local', VALUE: 20 }),
    statement('rbxl_player_set_jump_power', { PLAYER: 'local', VALUE: 15 }),
    statement('rbxl_player_damage', { PLAYER: 'local', VALUE: 12 }),
    statement('rbxl_player_heal', { PLAYER: 'local', VALUE: 5 }),
    statement('rbxl_teleport', { PLAYER: 'local', PART: 'Spawn' }),
    statement('rbxl_respawn', { PLAYER: 'local' }),
    statement('rbxl_set_variable', { NAME: 'hp' }, { VALUE: { block: value('rbxl_player_get_number', { PLAYER: 'local', PROPERTY: 'health' }) } }),
    statement('rbxl_set_variable', { NAME: 'alive' }, { VALUE: { block: value('rbxl_player_is_alive', { PLAYER: 'local' }) } })
  ];
  for (let i = 0; i < blocks.length - 1; i++) blocks[i].next = { block: blocks[i + 1] };
  const result = compileBlocklyWorkspace(start(blocks[0]));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.events[0].body.map((step) => step.op), [
    'playerSet', 'playerSet', 'playerSet', 'playerSet', 'playerDamage',
    'playerHeal', 'teleportToPart', 'respawn', 'setVariable', 'setVariable'
  ]);
  assert.equal(result.events[0].body[1].value.op, 'vector');
  assert.equal(result.events[0].body[8].value.property, 'health');
  assert.equal(result.events[0].body[9].value.property, 'alive');
});

test('M1-D Runtime uses explicit player adapter methods', () => {
  const state = { health: 100, alive: true, position: [0, 0, 0], walkSpeed: 16, jumpPower: 12 };
  const runtime = createBlocklyRuntime({ version: 1, events: [{ event: 'start', body: [
    { op: 'playerSet', player: 'local', property: 'health', value: { op: 'number', value: 75 } },
    { op: 'playerSet', player: 'local', property: 'position', value: { op: 'vector', values: [1, 2, 3].map((value) => ({ op: 'number', value })) } },
    { op: 'playerSet', player: 'local', property: 'walkSpeed', value: { op: 'number', value: 22 } },
    { op: 'playerDamage', player: 'local', amount: { op: 'number', value: 10 } },
    { op: 'playerHeal', player: 'local', amount: { op: 'number', value: 5 } },
    { op: 'setVariable', name: 'hp', value: { op: 'playerGet', player: 'local', property: 'health' } },
    { op: 'setVariable', name: 'alive', value: { op: 'playerGet', player: 'local', property: 'alive' } }
  ] }] }, {
    setPlayerProperty: (player, property, value) => { if (player !== 'local') return false; state[property] = value; return true; },
    damagePlayer: (player, amount) => { if (player !== 'local') return false; state.health = Math.max(0, state.health - amount); state.alive = state.health > 0; return true; },
    healPlayer: (player, amount) => { if (player !== 'local' || !state.alive) return false; state.health = Math.min(100, state.health + amount); return true; },
    getPlayerProperty: (player, property) => player === 'local' ? (property === 'positionX' ? state.position[0] : property === 'health' ? state.health : property === 'alive' ? state.alive : state[property] ?? null) : null
  });
  runtime.start();
  for (let i = 0; i < 12; i++) runtime.update(0.016);
  assert.equal(state.health, 70);
  assert.deepEqual(state.position, [1, 2, 3]);
  assert.equal(state.walkSpeed, 22);
  assert.equal(runtime.getVariables().hp, 70);
  assert.equal(runtime.getVariables().alive, true);
});

test('Game player adapter clamps stats, validates IDs, handles death and respawn', () => {
  const game = Object.create(Game.prototype);
  game.playerStats = { health: 100, maxHealth: 100, alive: true, walkSpeed: null, jumpPower: null };
  game.p = new THREE.Vector3(0, 5, 0);
  game.vel = new THREE.Vector3(1, 2, 3);
  game.grounded = true;
  game.spawn = [4, 8, 12];
  game.activeTriggers = new Set(['trigger']);
  game.activeRuleTriggers = new Set(['rule']);
  game.scriptRuntime = { onSpawn() {} };

  assert.equal(game.getPlayerProperty('local', 'health'), 100);
  assert.equal(game.getPlayerProperty('remote-1', 'health'), null);
  assert.equal(game.setPlayerProperty('remote-1', 'health', 20), false);
  assert.equal(game.setPlayerProperty('local', 'walkSpeed', 999), true);
  assert.equal(game.getPlayerProperty('local', 'walkSpeed'), 200);
  assert.equal(game.setPlayerProperty('local', 'jumpPower', -5), true);
  assert.equal(game.getPlayerProperty('local', 'jumpPower'), 0);
  assert.equal(game.setPlayerProperty('local', 'position', [1, 2, 3]), true);
  assert.deepEqual(game.p.toArray(), [1, 2, 3]);
  assert.equal(game.setPlayerProperty('local', 'position', [Infinity, 0, 0]), false);

  assert.equal(game.damagePlayer('local', 500), true);
  assert.equal(game.getPlayerProperty('local', 'health'), 0);
  assert.equal(game.getPlayerProperty('local', 'alive'), false);
  assert.deepEqual(game.vel.toArray(), [0, 0, 0]);
  assert.equal(game.healPlayer('local', 10), false);
  assert.equal(game.respawn('remote-1'), false);
  assert.equal(game.respawn('local'), true);
  assert.equal(game.getPlayerProperty('local', 'health'), 100);
  assert.equal(game.getPlayerProperty('local', 'alive'), true);
  assert.deepEqual(game.p.toArray(), [4, 8, 12]);
});

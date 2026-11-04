// M2-B: マルチプレイ(ホストがスクリプトを動かし、結果を配る)のテスト。
// 実行: node --import ./test/register.mjs test/multiplayer.test.mjs  (three はテスト用の代役)
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Game } from '../src/game/engine.js';
import { PlayerRegistry } from '../src/game/players.js';
import { newStats } from '../src/game/playerstats.js';
import { validGameMsg } from '../src/net/appmsg.js';
import { compileBlocklyWorkspace } from '../src/scripting/compiler.js';
import { createScriptingRuntime } from '../src/scripting/runtime.js';

const value = (type, fields = {}) => ({ type, fields, inputs: {} });
const stmt = (type, fields = {}, inputs = {}, next = null) => ({ type, fields, inputs, ...(next ? { next: { block: next } } : {}) });
const chain = (...blocks) => { for (let i = 0; i < blocks.length - 1; i++) blocks[i].next = { block: blocks[i + 1] }; return blocks[0]; };
const num = (n) => ({ block: value('math_number', { NUM: n }) });
const workspace = (...roots) => ({ blocks: { blocks: roots } });
const IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const trigger = (id, name, pos = [0, 0, 0], half = [5, 1, 5]) => ({ id, name, pos, rot: IDENT, half, size: half.map((h) => h * 2), enabled: true });

/** Game を、WebGL なしで必要なところだけ用意して作る */
function mkGame(trigs = []) {
  const game = Object.create(Game.prototype);
  Object.assign(game, {
    rules: { walkSpeed: 16, jumpPower: 50, gravity: 196.2 },
    playerStats: newStats(), p: new THREE.Vector3(0, 50, 0), vel: new THREE.Vector3(), grounded: true,
    keys: new Set(), joy: { x: 0, y: 0 }, jumpHeld: false, spawn: [0, 10, 0], completed: false,
    sy: [0.9, 2.65, 4.4], height: 5.3, scriptRuntime: null, logicRuntime: null,
    activeTriggers: new Set(), activeRuleTriggers: new Set(), logicHandlers: {}, eventRuleHandlers: {}, scriptHandlers: {},
    localId: 'local', netRole: 'solo', net: null, players: new PlayerRegistry(),
    partOverrides: new Map(), _partOut: new Map(), _netFlushAt: 0, scriptingWorkspace: null, eventRulesConfig: []
  });
  const calls = [];
  game.world = {
    triggers: [], ruleTriggers: trigs, ruleParts: trigs.map((t) => ({ ...t })),
    setPartVisible: (k, v) => { calls.push(['visible', k, v]); return true; },
    movePart: (k, v) => { calls.push(['move', k, v]); return true; },
    setPartProperty: (k, prop, v) => { calls.push(['prop', k, prop, v]); return true; },
    getPartProperty: () => 0
  };
  game.calls = calls;
  return game;
}
const mkNet = () => {
  const sent = [];
  return { sent, sendTo: (id, m) => sent.push(['to', id, m]), broadcast: (m) => sent.push(['all', m]), sendToHost: (m) => sent.push(['host', m]) };
};
const run = (game, seconds = 0.5) => { for (let i = 0; i < Math.ceil(seconds / 0.016); i++) { game._checkRemoteTriggers(); game.scriptRuntime.update(0.016); } };
const kinds = (sent, k) => sent.filter((e) => (e[0] === 'to' ? e[2] : e[1]).k === k);

test('appmsg: クライアントが送れるのは rs だけ。ホストからの各メッセージは範囲・型を検査する', () => {
  assert.deepEqual(validGameMsg({ t: 'g', k: 'rs' }, false), { t: 'g', k: 'rs' });
  assert.equal(validGameMsg({ t: 'g', k: 'stat', h: 1, mh: 100, a: 1, ws: null, jp: null }, false), null);
  assert.equal(validGameMsg({ t: 'g', k: 'tp', pos: [0, 0, 0] }, false), null);
  assert.deepEqual(validGameMsg({ t: 'g', k: 'stat', h: 70, mh: 100, a: 1, ws: 20, jp: null }, true), { t: 'g', k: 'stat', h: 70, mh: 100, a: 1, ws: 20, jp: null });
  assert.equal(validGameMsg({ t: 'g', k: 'stat', h: -1, mh: 100, a: 1, ws: null, jp: null }, true), null);
  assert.equal(validGameMsg({ t: 'g', k: 'stat', h: 1, mh: 100, a: 2, ws: null, jp: null }, true), null);
  assert.equal(validGameMsg({ t: 'g', k: 'stat', h: 1, mh: 100, a: 1, ws: 999, jp: null }, true), null);
  assert.deepEqual(validGameMsg({ t: 'g', k: 'tp', pos: [1, 2, 3], extra: 1 }, true), { t: 'g', k: 'tp', pos: [1, 2, 3] });
  assert.equal(validGameMsg({ t: 'g', k: 'tp', pos: [1, 2, NaN] }, true), null);
  assert.equal(validGameMsg({ t: 'g', k: 'tp', pos: [1, 2] }, true), null);
  assert.equal(validGameMsg({ t: 'g', k: 'score', v: 1e12, d: 1 }, true), null);
  assert.equal(validGameMsg({ t: 'g', k: 'msg', text: 'a\u0000b' }, true).text, 'ab', '制御文字は除く');
  assert.equal(validGameMsg({ t: 'g', k: 'msg', text: 'x'.repeat(900) }, true).text.length, 500, '500文字まで');
  assert.equal(validGameMsg({ t: 'g', k: 'part', key: 'Door', prop: 'visible', v: false }, true).v, false);
  assert.equal(validGameMsg({ t: 'g', k: 'part', key: 'Door', prop: 'visible', v: 'no' }, true), null);
  assert.equal(validGameMsg({ t: 'g', k: 'part', key: 'Door', prop: 'color', v: '#12abEF' }, true).v, '#12abEF');
  assert.equal(validGameMsg({ t: 'g', k: 'part', key: 'Door', prop: 'color', v: 'red' }, true), null);
  assert.equal(validGameMsg({ t: 'g', k: 'part', key: 'Door', prop: 'evil', v: 1 }, true), null);
  assert.equal(validGameMsg({ t: 'g', k: 'part', key: 'x'.repeat(101), prop: 'visible', v: true }, true), null);
  assert.equal(validGameMsg({ t: 'g', k: 'unknown' }, true), null);
  assert.equal(validGameMsg(null, true), null);
  assert.equal(validGameMsg({ t: 'x', k: 'rs' }, true), null);
});

test('PlayerRegistry: 状態の読み書き・ダメージ・回復・リスポーン', () => {
  const r = new PlayerRegistry();
  assert.equal(r.getProperty('p2', 'health'), null);
  r.add('p2', 'A');
  assert.equal(r.getProperty('p2', 'health'), 100);
  assert.equal(r.getProperty('p2', 'positionX'), null, '位置はまだ届いていない');
  assert.equal(r.setState('p2', [1, 2, 3, 0.5, 0, 1]), true);
  assert.deepEqual(['positionX', 'positionY', 'positionZ'].map((k) => r.getProperty('p2', k)), [1, 2, 3]);
  assert.equal(r.setState('p2', [Infinity, 0, 0, 0, 0, 0]), false);
  assert.equal(r.damage('p2', 30), true); assert.equal(r.getProperty('p2', 'health'), 70);
  assert.equal(r.heal('p2', 100), true); assert.equal(r.getProperty('p2', 'health'), 100);
  assert.equal(r.setProperty('p2', 'walkSpeed', 999), true); assert.equal(r.getProperty('p2', 'walkSpeed'), 200);
  assert.equal(r.damage('p2', 500), true); assert.equal(r.getProperty('p2', 'alive'), false);
  assert.equal(r.heal('p2', 10), false, '死んでいる間は回復できない');
  assert.equal(r.respawn('p2'), true); assert.equal(r.getProperty('p2', 'alive'), true); assert.equal(r.getProperty('p2', 'health'), 100);
  assert.equal(r.damage('nobody', 1), false);
  assert.deepEqual(r.statMessage('p2'), { t: 'g', k: 'stat', h: 100, mh: 100, a: 1, ws: 200, jp: null });
  assert.equal(r.remove('p2'), true); assert.equal(r.size, 0);
});

test('Runtime: ブロックの「local」は“そのイベントを起こしたプレイヤー”。得点はプレイヤーごとにも数える。複数人ではクリアで全体を止めない', () => {
  const seen = [];
  const rt = createScriptingRuntime({ version: 1, events: [
    { event: 'touch', target: 'Lava', body: [
      { op: 'playerDamage', player: 'local', amount: { op: 'number', value: 10 } },
      { op: 'addScore', amount: { op: 'number', value: 5 } },
      { op: 'teleportToPart', part: 'Spawn', player: 'local' },
      { op: 'checkpointAtPart', part: 'Spawn' },
      { op: 'respawn', player: 'local' },
      { op: 'respawn', player: 'p9' },
      { op: 'complete' }
    ] },
    { event: 'playerJoin', body: [{ op: 'setVariable', name: 'joined', value: { op: 'eventGet', property: 'playerId' } }] },
    { event: 'playerLeave', body: [{ op: 'setVariable', name: 'left', value: { op: 'eventGet', property: 'playerId' } }] },
    { event: 'touch', target: 'Coin', body: [{ op: 'addScore', amount: { op: 'number', value: 1 } }] }
  ] }, {
    stopsOnComplete: () => false,
    playerDamage: undefined,
    damagePlayer: (p, a) => { seen.push(['dmg', p, a]); return true; },
    teleportToPart: (k, p) => { seen.push(['tp', k, p]); return true; },
    checkpointAtPart: (k, p) => { seen.push(['cp', k, p]); },
    respawn: (p) => { seen.push(['rs', p]); return true; },
    complete: (p) => { seen.push(['done', p]); },
    onScore: (s, a, p) => seen.push(['score', s, a, p])
  });
  rt.start();
  rt.onTouch({ id: 'a', name: 'Lava' }, 'p2');
  rt.onTouch({ id: 'b', name: 'Coin' }, 'p3');
  rt.onPlayerJoin('p4'); rt.onPlayerLeave('p5');
  for (let i = 0; i < 60; i++) rt.update(0.016);
  assert.deepEqual(seen.filter((e) => e[0] !== 'score'), [
    ['dmg', 'p2', 10], ['tp', 'Spawn', 'p2'], ['cp', 'Spawn', 'p2'], ['rs', 'p2'], ['rs', 'p9'], ['done', 'p2']
  ]);
  // 各イベントは1フレームに1ステップずつ進むので、先頭で加点する Coin(p3)が先になる
  assert.deepEqual(seen.filter((e) => e[0] === 'score'), [['score', 1, 1, 'p3'], ['score', 6, 5, 'p2']]);
  assert.equal(rt.getScore(), 6, '全体の合計');
  assert.equal(rt.getPlayerScore('p2'), 5); assert.equal(rt.getPlayerScore('p3'), 1);
  assert.equal(rt.getVariables().joined, 'p4'); assert.equal(rt.getVariables().left, 'p5');
  rt.onTouch({ id: 'b', name: 'Coin' }, 'p3');
  for (let i = 0; i < 20; i++) rt.update(0.016);
  assert.equal(rt.getScore(), 7, 'クリア後もスクリプトは動き続ける');
});

test('Runtime: 1人プレイ(stopsOnComplete 未指定)は、これまでどおりクリアでスクリプトが止まる', () => {
  const rt = createScriptingRuntime({ version: 1, events: [
    { event: 'start', body: [{ op: 'complete' }] },
    { event: 'touch', target: 'Coin', body: [{ op: 'addScore', amount: { op: 'number', value: 1 } }] }
  ] }, { complete: () => {} });
  rt.start(); rt.update(0.016);
  rt.onTouch({ id: 'b', name: 'Coin' }, 'local'); rt.update(0.016); rt.update(0.016);
  assert.equal(rt.getScore(), 0);
});

test('コンパイラ: 参加・退出イベントのブロック', () => {
  const r = compileBlocklyWorkspace(workspace(stmt('rbxl_when_player_join'), stmt('rbxl_when_player_leave')));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.events.map((e) => e.event), ['playerJoin', 'playerLeave']);
});

test('ホスト: 参加→位置→トリガー判定→ダメージ・得点・メッセージを、該当プレイヤーと全員へ', () => {
  const game = mkGame([trigger('t1', 'Lava')]);
  game.scriptingWorkspace = workspace(
    stmt('rbxl_when_touch', { PART: 'Lava' }, {}, chain(
      stmt('rbxl_player_damage', { PLAYER: 'local' }, { VALUE: num(30) }),
      stmt('rbxl_add_score', {}, { VALUE: num(2) }),
      stmt('rbxl_show_message', { TEXT: 'あつい' }))),
    stmt('rbxl_when_player_join', {}, {}, stmt('rbxl_show_message', { TEXT: 'ようこそ' }))
  );
  const net = mkNet();
  game.setNet('host', 'p1', net);
  game._createUnifiedRuntime();
  // 自分(p1)と p2 がいる。p2 が入った瞬間に、いまの状態が届き、参加イベントが走る
  game.netPlayers([{ id: 'p1', name: 'H' }, { id: 'p2', name: 'A' }]);
  assert.ok(game.players.has('p2') && !game.players.has('p1'));
  assert.equal(kinds(net.sent, 'score').length, 1); assert.equal(kinds(net.sent, 'stat').length, 1);
  net.sent.length = 0;
  run(game, 0.2);
  assert.deepEqual(kinds(net.sent, 'msg').map((e) => e[1].text), ['ようこそ']);
  net.sent.length = 0;
  // p2 の位置が届く(トリガーの外)→ 何も起きない。中へ入ると touch が起きる
  game.netSnapshot([{ id: 'p2', name: 'A', s: [50, 1, 50, 0, 0, 1] }]); run(game, 0.2);
  assert.equal(net.sent.length, 0);
  game.netSnapshot([{ id: 'p2', name: 'A', s: [0, 1, 0, 0, 0, 1] }]); run(game, 0.3);
  const stats = kinds(net.sent, 'stat');
  assert.equal(stats.length, 1); assert.equal(stats[0][1], 'p2'); assert.equal(stats[0][2].h, 70);
  assert.equal(game.players.getProperty('p2', 'health'), 70);
  assert.equal(game.playerStats.health, 100, 'p1(ホスト自身)は影響を受けない');
  assert.deepEqual(kinds(net.sent, 'score').map((e) => [e[0], e[1].v, e[1].d]), [['all', 2, 2]]);
  assert.deepEqual(kinds(net.sent, 'msg').map((e) => [e[0], e[1].text]), [['all', 'あつい']]);
  assert.equal(game.scriptRuntime.getPlayerScore('p2'), 2);
  // 触れ続けても、もう1回は起きない。離れて、また触れると起きる
  net.sent.length = 0; run(game, 0.3);
  assert.equal(net.sent.length, 0);
  game.netSnapshot([{ id: 'p2', name: 'A', s: [50, 1, 50, 0, 0, 1] }]); run(game, 0.1);
  game.netSnapshot([{ id: 'p2', name: 'A', s: [0, 1, 0, 0, 0, 1] }]); run(game, 0.3);
  assert.equal(game.players.getProperty('p2', 'health'), 40);
  // 退出: 一覧から消え、触れていた記録も片付く
  game.netPlayers([{ id: 'p1', name: 'H' }]);
  assert.equal(game.players.size, 0);
});

test('ホスト: 他のプレイヤーへの移動・チェックポイント・リスポーン・クリア・HP設定は、そのプレイヤーへだけ送る', () => {
  const game = mkGame([trigger('t1', 'Goal')]);
  game.scriptingWorkspace = workspace(stmt('rbxl_when_touch', { PART: 'Goal' }, {}, chain(
    stmt('rbxl_set_checkpoint'),
    stmt('rbxl_complete'))));
  const net = mkNet();
  game.setNet('host', 'p1', net);
  game._createUnifiedRuntime();
  game.netPlayers([{ id: 'p1', name: 'H' }, { id: 'p2', name: 'A' }, { id: 'p3', name: 'B' }]);
  net.sent.length = 0;
  game.netSnapshot([{ id: 'p2', name: 'A', s: [0, 1, 0, 0, 0, 1] }, { id: 'p3', name: 'B', s: [60, 1, 60, 0, 0, 1] }]);
  run(game, 0.3);
  const cp = net.sent.filter((e) => e[0] === 'to' && e[2].k === 'cp'), done = net.sent.filter((e) => e[0] === 'to' && e[2].k === 'done');
  assert.deepEqual(cp.map((e) => [e[1], e[2].pos]), [['p2', [0, 1, 0]]]);
  assert.deepEqual(done.map((e) => e[1]), ['p2']);
  assert.equal(game.completed, false, 'ホスト自身はクリアしていない');
  assert.equal(game.players.get('p2').completed, true);
  // クリアしたプレイヤーのあとも、ほかのプレイヤーの判定は続く
  net.sent.length = 0;
  game.netSnapshot([{ id: 'p3', name: 'B', s: [0, 1, 0, 0, 0, 1] }]); run(game, 0.3);
  assert.deepEqual(net.sent.filter((e) => e[0] === 'to' && e[2].k === 'done').map((e) => e[1]), ['p3']);
  // 直接のAPI
  net.sent.length = 0;
  assert.equal(game.setPlayerPosition('p3', [1, 2, 3]), true);
  assert.equal(game.setPlayerPosition('p3', [1, 2, NaN]), false);
  assert.equal(game.setPlayerProperty('p3', 'health', 10), true);
  assert.equal(game.damagePlayer('p3', 50), true);
  assert.equal(game.getPlayerProperty('p3', 'alive'), false);
  assert.equal(game.respawn('p3'), true);
  assert.equal(game.getPlayerProperty('p3', 'health'), 100);
  assert.equal(game.respawn('nobody'), false);
  assert.deepEqual(net.sent.map((e) => [e[0], e[1], e[2].k]), [
    ['to', 'p3', 'tp'], ['to', 'p3', 'stat'], ['to', 'p3', 'stat'], ['to', 'p3', 'rs']
  ]);
});

test('ホスト: スクリプトで変えたパーツは、10Hzでまとめて全員へ配り、途中参加者にはいまの状態を送る。ホストが先にクリアしても止まらない', () => {
  const game = mkGame();
  const net = mkNet();
  game.setNet('host', 'p1', net);
  game._createUnifiedRuntime();
  game._queuePart('Door', 'visible', false);
  game._queuePart('Door', 'move', [1, 2, 3]);
  game._queuePart('Door', 'move', [4, 5, 6]); // 同じ(パーツ,項目)は最新だけ
  game._flushNet();
  assert.deepEqual(net.sent.map((e) => [e[0], e[1].prop, e[1].v]), [['all', 'visible', false], ['all', 'move', [4, 5, 6]]]);
  net.sent.length = 0;
  game._queuePart('Door', 'visible', true);
  game._flushNet();
  assert.equal(net.sent.length, 0, '前回から100ms以内は送らない');
  game._netFlushAt = 0; game._flushNet();
  assert.equal(net.sent.length, 1);
  // 途中参加者: Door の最新の状態(move → visible の順)が届く
  net.sent.length = 0;
  game.netPlayers([{ id: 'p1', name: 'H' }, { id: 'p5', name: 'E' }]);
  assert.deepEqual(kinds(net.sent, 'part').map((e) => [e[1], e[2].prop, e[2].v]), [['p5', 'move', [4, 5, 6]], ['p5', 'visible', true]], 'move → visible の順');
  // ホストがクリアしても、スクリプトとリモートの判定は続く
  game.completed = true;
  game.world.ruleTriggers.push(trigger('t9', 'Coin'));
  game.scriptingWorkspace = workspace(stmt('rbxl_when_touch', { PART: 'Coin' }, {}, stmt('rbxl_add_score', {}, { VALUE: num(1) })));
  game._createUnifiedRuntime();
  game.netSnapshot([{ id: 'p5', name: 'E', s: [0, 1, 0, 0, 0, 1] }]);
  game.update(0.016); game.update(0.016); game.update(0.016);
  assert.equal(game.scriptRuntime.getScore(), 1);
});

test('クライアント: スクリプトは動かさず、ホストからの状態・移動・リスポーン・クリア・スコア・メッセージ・パーツを反映する', () => {
  const game = mkGame([trigger('t1', 'Lava')]);
  game.scriptingWorkspace = workspace(stmt('rbxl_when_start', {}, {}, stmt('rbxl_show_message', { TEXT: 'x' })));
  game._createUnifiedRuntime();
  assert.ok(game.scriptRuntime);
  const net = mkNet();
  const log = [];
  game.scriptHandlers = { onScore: (s, d) => log.push(['score', s, d]), onMessage: (t) => log.push(['msg', t]) };
  game.logicHandlers = { onComplete: () => log.push(['done']) };
  game.setNet('client', 'p2', net);
  assert.equal(game.scriptRuntime, null, 'クライアントはスクリプトを動かさない');
  game.netGame('p1', { t: 'g', k: 'stat', h: 40, mh: 100, a: 1, ws: 8, jp: null });
  assert.equal(game.getPlayerProperty('local', 'health'), 40); assert.equal(game.getPlayerProperty('local', 'walkSpeed'), 8);
  game.netGame('p1', { t: 'g', k: 'stat', h: 0, mh: 100, a: 0, ws: null, jp: null });
  assert.equal(game.playerStats.alive, false);
  game.netGame('p1', { t: 'g', k: 'tp', pos: [7, 8, 9] });
  assert.deepEqual([game.p.x, game.p.y, game.p.z], [7, 8, 9]);
  game.netGame('p1', { t: 'g', k: 'cp', pos: [1, 1, 1] });
  assert.deepEqual(game.spawn, [1, 1, 1]);
  game.netGame('p1', { t: 'g', k: 'rs' });
  assert.equal(game.playerStats.alive, true); assert.deepEqual([game.p.x, game.p.y, game.p.z], [1, 1, 1]);
  assert.equal(net.sent.length, 0, 'ホストの命令でのリスポーンは、ホストへ知らせ返さない');
  game.respawn(); // 自分で戻った(落下・やり直しなど)→ ホストへ知らせる
  assert.deepEqual(net.sent, [['host', { t: 'g', k: 'rs' }]]);
  game.netGame('p1', { t: 'g', k: 'score', v: 9, d: 3 });
  game.netGame('p1', { t: 'g', k: 'msg', text: 'こんにちは' });
  game.netGame('p1', { t: 'g', k: 'done' });
  assert.deepEqual(log, [['score', 9, 3], ['msg', 'こんにちは'], ['done']]);
  assert.equal(game.completed, true);
  game.netGame('p1', { t: 'g', k: 'part', key: 'Door', prop: 'visible', v: false });
  game.netGame('p1', { t: 'g', k: 'part', key: 'Door', prop: 'move', v: [1, 2, 3] });
  game.netGame('p1', { t: 'g', k: 'part', key: 'Door', prop: 'color', v: '#aabbcc' });
  assert.deepEqual(game.calls, [['visible', 'Door', false], ['move', 'Door', [1, 2, 3]], ['prop', 'Door', 'color', '#aabbcc']]);
  // ルームを出たら1人プレイに戻る(スクリプトが再び動き、HPなどは初期状態)
  game.clearNet();
  assert.equal(game.netRole, 'solo'); assert.ok(game.scriptRuntime); assert.equal(game.completed, false);
  assert.equal(game.playerStats.health, 100); assert.equal(game.playerStats.walkSpeed, null);
});

test('1人プレイ: ネットワークの有無に関係なく、何も送らず、これまでどおり動く', () => {
  const game = mkGame([trigger('t1', 'Lava')]);
  game.scriptingWorkspace = workspace(stmt('rbxl_when_touch', { PART: 'Lava' }, {}, stmt('rbxl_player_damage', { PLAYER: 'local' }, { VALUE: num(10) })));
  game._createUnifiedRuntime();
  game.p.set(0, 1, 0);
  game._checkTriggers();
  for (let i = 0; i < 10; i++) game.scriptRuntime.update(0.016);
  assert.equal(game.playerStats.health, 90);
  assert.equal(game._isRemote('p2'), false);
  assert.equal(game.damagePlayer('p2', 1), false);
  game._sendAll({ t: 'g', k: 'msg', text: 'x' }); // netRole が solo なので何も起きない(例外も出ない)
});

test('ホスト: クライアントが自分でリスポーンしたと知らせてきたら、HPをリセットして spawn イベントを走らせる(知らない相手は無視)', () => {
  const game = mkGame();
  game.scriptingWorkspace = workspace(stmt('rbxl_when_player_spawn', {}, {}, stmt('rbxl_add_score', {}, { VALUE: num(1) })));
  const net = mkNet();
  game.setNet('host', 'p1', net);
  game._createUnifiedRuntime();
  game.netPlayers([{ id: 'p1', name: 'H' }, { id: 'p2', name: 'A' }]);
  run(game, 0.3);
  const before = game.scriptRuntime.getScore(); // ホスト自身の初回スポーン + p2 の参加時スポーン
  game.damagePlayer('p2', 60);
  game.netGame('p2', { t: 'g', k: 'rs' });
  assert.equal(game.players.getProperty('p2', 'health'), 100);
  run(game, 0.3);
  assert.equal(game.scriptRuntime.getScore(), before + 1);
  game.netGame('p9', { t: 'g', k: 'rs' }); // 参加していない相手
  run(game, 0.3);
  assert.equal(game.scriptRuntime.getScore(), before + 1);
});

// マルチプレイ通信仕様(プロトコル)の最小テスト
import assert from 'node:assert/strict';
import { ROOM_CODE_RE, MAX_MSG_CHARS, cleanName, packState, validState, encode, decode, validSnapshot, validPlayers } from '../src/net/protocol.js';

assert.ok(ROOM_CODE_RE.test('AB2C3D') && !ROOM_CODE_RE.test('ab2c3d') && !ROOM_CODE_RE.test('AB2C3') && !ROOM_CODE_RE.test('AB2C31'));
assert.equal(cleanName('  <b>Taro</b>\n '), 'bTaro/b'); assert.equal(cleanName(''), 'Player'); assert.equal(cleanName('x'.repeat(40)).length, 20);

const s = packState([1.234, 5, -6.789, 0.5, 3.14159, true]);
assert.deepEqual(s, [1.23, 5, -6.79, 0.5, 3.14, 1]);
assert.deepEqual(validState(s), s);
assert.equal(validState([1, 2, 3]), null);
assert.equal(validState([NaN, 0, 0, 0, 0, 0]), null);
assert.equal(validState([1e9, 0, 0, 0, 0, 0]), null);
assert.equal(validState(['1', 0, 0, 0, 0, 0]), null);
assert.equal(validState([0, 0, 0, 0, -5, 0])[4], 0);

assert.deepEqual(decode(encode({ t: 'ping', c: 1 })), { t: 'ping', c: 1 });
assert.equal(decode('not json'), null); assert.equal(decode('[1,2]'), null); assert.equal(decode('x'.repeat(MAX_MSG_CHARS + 1)), null); assert.equal(decode(5), null);

const snap = { t: 'S', h: 12.5, p: [['p1', ...s], ['p2', ...s]] };
assert.deepEqual(validSnapshot(snap).map((e) => e.id), ['p1', 'p2']);
assert.equal(validSnapshot({ ...snap, p: [['p1', 1, 2]] }), null);
assert.equal(validSnapshot({ ...snap, p: Array.from({ length: 9 }, (_, i) => ['p' + i, ...s]) }), null);
assert.equal(validSnapshot({ ...snap, h: 'x' }), null);
assert.equal(validSnapshot({ ...snap, t: 's' }), null);

assert.deepEqual(validPlayers([{ id: 'p1', name: 'A' }]), [{ id: 'p1', name: 'A' }]);
assert.equal(validPlayers([{ id: '', name: 'A' }]), null);
console.log('net-protocol: ok');

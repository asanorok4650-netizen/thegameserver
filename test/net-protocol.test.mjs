// マルチプレイ通信仕様(プロトコル)のテスト: バイナリの状態パケット・連番・制御メッセージ
import assert from 'node:assert/strict';
import {
  ROOM_CODE_RE, MAX_MSG_CHARS, STATE_BYTES, STATE_BODY_OFFSET, cleanName, encode, decode,
  encodeState, decodeState, seqNewer, validPlayers, joinOrder
} from '../src/net/protocol.js';

assert.ok(ROOM_CODE_RE.test('AB2C3D') && !ROOM_CODE_RE.test('ab2c3d') && !ROOM_CODE_RE.test('AB2C3') && !ROOM_CODE_RE.test('AB2C31'));
assert.equal(cleanName('  <b>Taro</b>\n '), 'bTaro/b'); assert.equal(cleanName(''), 'Player'); assert.equal(cleanName('x'.repeat(40)).length, 20);

// ── 状態パケット: 16バイト。量子化の誤差は 位置 1/128 stud 以内、向き 0.0001rad 以内、速さ 0.25 以内 ──
{
  const s = [123.456, -5.1, 9999.99, 1.2345, 16, 1];
  const buf = encodeState(7, s);
  assert.ok(buf instanceof ArrayBuffer); assert.equal(buf.byteLength, STATE_BYTES); assert.equal(STATE_BYTES, 16);
  const d = decodeState(buf);
  assert.equal(d.seq, 7);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(d.s[i] - s[i]) <= 1 / 128 + 1e-9, `位置${i}: ${d.s[i]}`);
  assert.ok(Math.abs(d.s[3] - s[3]) < 1e-4, '向き'); assert.ok(Math.abs(d.s[4] - 16) <= 0.25, '速さ'); assert.equal(d.s[5], 1);
}

// 負の座標・ゼロ・大きな座標(±131071 stud)
{
  for (const v of [0, -0.01, -1, -131071, 131071, -64.5, 2048.015625]) {
    const d = decodeState(encodeState(0, [v, v, v, 0, 0, 0]));
    assert.ok(Math.abs(d.s[0] - v) <= 1 / 128 + 1e-9, `${v} → ${d.s[0]}`);
  }
  // 範囲外は端に寄せる(壊れた値にならない)
  const far = decodeState(encodeState(0, [1e9, -1e9, 0, 0, 0, 0]));
  assert.ok(far.s[0] > 131000 && far.s[1] < -131000);
}

// 向き: 何周していても、負でも、同じ向きに丸まる。0 と 2π は同じ
{
  const same = (a, b) => { const d = Math.atan2(Math.sin(a - b), Math.cos(a - b)); return Math.abs(d) < 1e-3; };
  for (const h of [0, 1, -1, 3.14, -3.14, 7, -50, 1000, Math.PI * 2]) assert.ok(same(decodeState(encodeState(0, [0, 0, 0, h, 0, 0])).s[3], h), 'heading ' + h);
}

// 速さ: 負は0、上限は127.5
{
  assert.equal(decodeState(encodeState(0, [0, 0, 0, 0, -5, 0])).s[4], 0);
  assert.equal(decodeState(encodeState(0, [0, 0, 0, 0, 9999, 0])).s[4], 127.5);
  assert.equal(decodeState(encodeState(0, [0, 0, 0, 0, 0, 0])).s[5], 0);
  assert.equal(decodeState(encodeState(0, [0, 0, 0, 0, 0, true])).s[5], 1);
}

// 作れない・読めないものは null(NaN / 数値でない / 長さ違い / 種別違い / ArrayBuffer以外)
{
  assert.equal(encodeState(0, [NaN, 0, 0, 0, 0, 0]), null);
  assert.equal(encodeState(0, [0, Infinity, 0, 0, 0, 0]), null);
  assert.equal(encodeState(0, ['1', 0, 0, 0, 0, 0]), null);
  assert.equal(encodeState(0, [0, 0, 0]), null);
  assert.equal(encodeState(0, undefined), null);
  const good = encodeState(1, [1, 2, 3, 0, 0, 0]);
  assert.equal(decodeState(good.slice(0, 15)), null);
  assert.equal(decodeState(new ArrayBuffer(17)), null);
  const bad = good.slice(0); new Uint8Array(bad)[0] = 9;
  assert.equal(decodeState(bad), null);
  assert.equal(decodeState('x'), null); assert.equal(decodeState(null), null); assert.equal(decodeState(new Uint8Array(good)), null);
}

// 連番: uint16で一周しても新旧を比べられる
{
  assert.equal(decodeState(encodeState(65536 + 5, [0, 0, 0, 0, 0, 0])).seq, 5);
  assert.ok(seqNewer(1, 0) && seqNewer(0, 65535) && seqNewer(10, 65530));
  assert.ok(!seqNewer(0, 1) && !seqNewer(65535, 0) && !seqNewer(5, 5));
  assert.ok(seqNewer(32768 + 5, 5) === false, '半周より先は古い扱い'); assert.ok(seqNewer(5 + 32767, 5));
}

// 連番を除いた中身: 同じ状態なら連番が違っても同じ(止まっている間の送信間引きに使う)
{
  const a = new Uint8Array(encodeState(1, [1, 2, 3, 0.5, 4, 1]), STATE_BODY_OFFSET);
  const b = new Uint8Array(encodeState(2, [1, 2, 3, 0.5, 4, 1]), STATE_BODY_OFFSET);
  const c = new Uint8Array(encodeState(3, [1.1, 2, 3, 0.5, 4, 1]), STATE_BODY_OFFSET);
  assert.deepEqual([...a], [...b]); assert.notDeepEqual([...a], [...c]);
}

// JSONの制御メッセージ
assert.deepEqual(decode(encode({ t: 'bye' })), { t: 'bye' });
assert.equal(decode('not json'), null); assert.equal(decode('[1,2]'), null); assert.equal(decode('x'.repeat(MAX_MSG_CHARS + 1)), null); assert.equal(decode(5), null);

// 参加者リスト(Roomからの hello)と参加順
assert.deepEqual(validPlayers([{ id: 'p1', name: 'A' }]), [{ id: 'p1', name: 'A' }]);
assert.deepEqual(validPlayers([{ id: 'p2', name: '<x>' }]), [{ id: 'p2', name: 'x' }]);
assert.equal(validPlayers([{ id: '', name: 'A' }]), null); assert.equal(validPlayers([{ id: 'x1', name: 'A' }]), null);
assert.equal(validPlayers([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }, { id: 'p5' }, { id: 'p6' }, { id: 'p7' }, { id: 'p8' }, { id: 'p9' }]), null);
assert.equal(validPlayers('x'), null);
assert.ok(joinOrder('p2') < joinOrder('p10') && joinOrder('p10') === 10);
console.log('net-protocol: ok');

// P2Pマルチプレイの通信仕様(ホストレス・フルメッシュ)。THREE・ブラウザ非依存なのでNodeでテストできる。
// - DataChannel 'ctl'(順序あり・信頼): JSON。bye など、まれにしか流れない制御だけ
// - DataChannel 'st' (順序なし・再送なし): バイナリ16バイトの状態パケット(下の encodeState / decodeState)。
//   送り主は DataChannel から分かるので、パケットにIDは載せない(フルメッシュ。中継を入れるときに送り主IDの欄を足す)。
//   順序が入れ替わるので連番(uint16, 一周する)を付け、受け取った側は「最後に採用した連番より新しいもの」だけを使う
export const MAX_PLAYERS = 8;
export const ROOM_CODE_RE = /^[A-Z2-9]{6}$/;
export const MAX_MSG_CHARS = 2048; // ctl 1メッセージの上限(超えたものは捨てる)
export const PEER_TIMEOUT_MS = 10000; // これだけ何も届かない相手は切れたものとして扱う
export const CTL_MAX_PER_SEC = 20;    // 制御チャネルの1秒あたりの受付上限
export const DEFAULT_SEND_HZ = 10;
export const IDLE_HEARTBEAT_MS = 500; // 動いていない間は、この間隔でしか送らない(取りこぼしの補正も兼ねる)
// TURNは未設定(回線によっては直接つながらない)。必要になったらここへ追加する
export const ICE_SERVERS = [{ urls: 'stun:stun.cloudflare.com:3478' }];

// ── 状態パケット(16バイト、リトルエンディアン) ──
//  0      : 種別(1 = 状態)
//  1-2    : 連番 uint16
//  3-5    : x  int24  (1/64 stud 単位。±131071 stud)
//  6-8    : y  int24
//  9-11   : z  int24
//  12-13  : 向き uint16 (0〜2π を65536分割)
//  14     : 速さ uint8 (0.5 stud/s 単位。0〜127.5)
//  15     : フラグ (bit0 = 接地)
export const STATE_BYTES = 16;
export const STATE_BODY_OFFSET = 3; // 連番を除いた中身の開始位置(「前回と同じか」の比較用)
const TYPE_STATE = 1;
const POS_SCALE = 64;
const POS_MIN = -(2 ** 23), POS_MAX = 2 ** 23 - 1;
const SPEED_SCALE = 2;
const TAU = Math.PI * 2;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
function putI24(dv, at, v) {
  const q = clamp(Math.round(v * POS_SCALE), POS_MIN, POS_MAX) & 0xffffff;
  dv.setUint8(at, q & 0xff); dv.setUint8(at + 1, (q >> 8) & 0xff); dv.setUint8(at + 2, (q >> 16) & 0xff);
}
function getI24(dv, at) {
  let q = dv.getUint8(at) | (dv.getUint8(at + 1) << 8) | (dv.getUint8(at + 2) << 16);
  if (q & 0x800000) q -= 0x1000000;
  return q / POS_SCALE;
}

/** 状態 s = [x, y, z, heading(rad), speed, grounded] と連番を、16バイトにする。数値でないものがあれば null */
export function encodeState(seq, s) {
  if (!Array.isArray(s) || s.length < 6) return null;
  for (let i = 0; i < 5; i++) if (typeof s[i] !== 'number' || !Number.isFinite(s[i])) return null;
  const buf = new ArrayBuffer(STATE_BYTES);
  const dv = new DataView(buf);
  dv.setUint8(0, TYPE_STATE);
  dv.setUint16(1, seq & 0xffff, true);
  putI24(dv, 3, s[0]); putI24(dv, 6, s[1]); putI24(dv, 9, s[2]);
  const h = ((s[3] % TAU) + TAU) % TAU;
  dv.setUint16(12, Math.round((h / TAU) * 65536) & 0xffff, true);
  dv.setUint8(14, clamp(Math.round(Math.max(0, s[4]) * SPEED_SCALE), 0, 255));
  dv.setUint8(15, s[5] ? 1 : 0);
  return buf;
}

/** 16バイトの状態パケット → { seq, s:[x,y,z,heading,speed,grounded] }。長さや種別が違えば null */
export function decodeState(buf) {
  if (!(buf instanceof ArrayBuffer) || buf.byteLength !== STATE_BYTES) return null;
  const dv = new DataView(buf);
  if (dv.getUint8(0) !== TYPE_STATE) return null;
  return {
    seq: dv.getUint16(1, true),
    s: [getI24(dv, 3), getI24(dv, 6), getI24(dv, 9), (dv.getUint16(12, true) / 65536) * TAU, dv.getUint8(14) / SPEED_SCALE, dv.getUint8(15) & 1]
  };
}

/** uint16の連番 a が b より新しいか(一周しても比べられる。同じ値は新しくない) */
export const seqNewer = (a, b) => a !== b && ((a - b) & 0xffff) < 0x8000;

/** 表示名: 制御文字と < > を除き、20文字まで。空なら Player */
export function cleanName(s) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 20) || 'Player';
}

export const encode = (msg) => JSON.stringify(msg);

/** 文字列 → オブジェクト。大きすぎる・壊れている・配列などは null */
export function decode(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_MSG_CHARS) return null;
  try {
    const m = JSON.parse(raw);
    return m && typeof m === 'object' && !Array.isArray(m) ? m : null;
  } catch (e) { return null; }
}

/** 参加者リスト [{id,name}] の検証(Roomからの hello 用)。不正なら null */
export function validPlayers(list) {
  if (!Array.isArray(list) || list.length > MAX_PLAYERS) return null;
  const out = [];
  for (const p of list) {
    if (!p || typeof p.id !== 'string' || !/^p\d{1,9}$/.test(p.id)) return null;
    out.push({ id: p.id, name: cleanName(p.name) });
  }
  return out;
}

/** 参加の順番(Roomが振る連番)。小さいほうが先に入った人 */
export const joinOrder = (id) => parseInt(String(id).slice(1), 10);

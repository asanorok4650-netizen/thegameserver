// P2Pマルチプレイの通信仕様(Hybrid P2P / Host型Star)。THREE・ブラウザ非依存なのでNodeでテストできる。
// - DataChannel 'ctl'(順序あり・信頼): hello / welcome / join / leave / ping / pong
// - DataChannel 'st' (順序なし・再送なし): 's'(クライアント→ホスト)と 'S'(ホスト→全員)
export const MAX_PLAYERS = 8;
export const ROOM_CODE_RE = /^[A-Z2-9]{6}$/;
export const MAX_MSG_CHARS = 2048; // DataChannel 1メッセージの上限(超えたものは捨てる)
export const POS_LIMIT = 100000;
export const DEFAULT_SEND_HZ = 10;
// TURNは未設定(回線によっては直接つながらない)。必要になったらここへ追加する
export const ICE_SERVERS = [{ urls: 'stun:stun.cloudflare.com:3478' }];

const finiteIn = (v, lim) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
const r2 = (v) => Math.round(v * 100) / 100;

/** 表示名: 制御文字と < > を除き、20文字まで。空なら Player */
export function cleanName(s) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 20) || 'Player';
}

/** 状態 = [x, y, z, heading, speed, grounded(0|1)] */
export function packState(a) {
  return [r2(a[0]), r2(a[1]), r2(a[2]), r2(a[3]), r2(a[4]), a[5] ? 1 : 0];
}

/** 正しい状態なら正規化した配列を、不正なら null を返す */
export function validState(a) {
  if (!Array.isArray(a) || a.length !== 6) return null;
  if (!finiteIn(a[0], POS_LIMIT) || !finiteIn(a[1], POS_LIMIT) || !finiteIn(a[2], POS_LIMIT)) return null;
  if (!finiteIn(a[3], 1000) || !finiteIn(a[4], 1000)) return null;
  return [a[0], a[1], a[2], a[3], Math.max(0, a[4]), a[5] ? 1 : 0];
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

/** ホストのスナップショット {t:'S', h, p:[[id,x,y,z,heading,speed,grounded],...]} を検証。OKなら [{id, s}] */
export function validSnapshot(m) {
  if (!m || m.t !== 'S' || !finiteIn(m.h, 1e9) || !Array.isArray(m.p) || m.p.length > MAX_PLAYERS) return null;
  const out = [];
  for (const e of m.p) {
    if (!Array.isArray(e) || e.length !== 7 || typeof e[0] !== 'string' || !e[0] || e[0].length > 16) return null;
    const s = validState(e.slice(1));
    if (!s) return null;
    out.push({ id: e[0], s });
  }
  return out;
}

/** 参加者リスト [{id,name}] の検証(welcome用)。不正なら null */
export function validPlayers(list) {
  if (!Array.isArray(list) || list.length > MAX_PLAYERS) return null;
  const out = [];
  for (const p of list) {
    if (!p || typeof p.id !== 'string' || !p.id || p.id.length > 16) return null;
    out.push({ id: p.id, name: cleanName(p.name) });
  }
  return out;
}

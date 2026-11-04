// プレイヤーのHP・生存・歩行速度・ジャンプ力の計算(THREE非依存)。
// ローカルプレイヤー(engine.js)と、ホストが管理するリモートプレイヤー(players.js)で同じ規則を使う。
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const MAX_SPEED_PARAM = 200;

export const newStats = () => ({ health: 100, maxHealth: 100, alive: true, walkSpeed: null, jumpPower: null });

/** 現在の値。rules は既定の歩行速度・ジャンプ力(manifest.rules) */
export function readStat(s, property, rules) {
  switch (property) {
    case 'health': return s.health;
    case 'maxHealth': return s.maxHealth;
    case 'alive': return s.alive;
    case 'walkSpeed': return s.walkSpeed ?? rules?.walkSpeed ?? 16;
    case 'jumpPower': return s.jumpPower ?? rules?.jumpPower ?? 50;
    default: return undefined;
  }
}

/** health / walkSpeed / jumpPower を設定。受け付けたら true。health が 0 になったか(死んだか)は s.alive で見る */
export function writeStat(s, property, value) {
  if (!isNum(value)) return false;
  if (property === 'health') { s.health = Math.max(0, Math.min(s.maxHealth, value)); s.alive = s.health > 0; return true; }
  if (property === 'walkSpeed') { s.walkSpeed = Math.max(0, Math.min(MAX_SPEED_PARAM, value)); return true; }
  if (property === 'jumpPower') { s.jumpPower = Math.max(0, Math.min(MAX_SPEED_PARAM, value)); return true; }
  return false;
}

export function damageStat(s, amount) {
  if (!s.alive || !isNum(amount)) return false;
  s.health = Math.max(0, s.health - Math.max(0, amount));
  s.alive = s.health > 0;
  return true;
}

export function healStat(s, amount) {
  if (!s.alive || !isNum(amount)) return false;
  s.health = Math.min(s.maxHealth, s.health + Math.max(0, amount));
  return true;
}

export function resetStat(s) { s.health = s.maxHealth; s.alive = true; }

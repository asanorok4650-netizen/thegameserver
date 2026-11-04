// ホストが持つ「他のプレイヤー」の状態(THREE非依存)。位置は各プレイヤーから届いたもの(信用ベース)、
// HP・生存・速度・クリアはホストが権威を持つ。スクリプトの touch/leave 判定のため、触れているトリガーも覚える。
import { newStats, readStat, writeStat, damageStat, healStat, resetStat } from './playerstats.js';

const POS_LIMIT = 100000;
const okPos = (p) => Array.isArray(p) && p.length === 3 && p.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= POS_LIMIT);

export class PlayerRegistry {
  constructor() { this.map = new Map(); }

  get size() { return this.map.size; }
  has(id) { return this.map.has(id); }
  get(id) { return this.map.get(id) || null; }
  ids() { return [...this.map.keys()]; }
  list() { return [...this.map.values()]; }

  add(id, name = '') {
    if (!this.map.has(id)) this.map.set(id, { id, name, stats: newStats(), pos: null, heading: 0, completed: false, active: new Set() });
    return this.map.get(id);
  }
  remove(id) { return this.map.delete(id); }
  clear() { this.map.clear(); }

  /** スナップショットの状態 [x,y,z,heading,speed,grounded] から位置を更新 */
  setState(id, s) {
    const p = this.map.get(id);
    if (!p || !Array.isArray(s) || !okPos([s[0], s[1], s[2]])) return false;
    p.pos = [s[0], s[1], s[2]];
    p.heading = Number.isFinite(s[3]) ? s[3] : 0;
    return true;
  }

  /** 値を読む。未登録のIDは null */
  getProperty(id, property, rules) {
    const p = this.map.get(id);
    if (!p) return null;
    if (property === 'positionX' || property === 'positionY' || property === 'positionZ') {
      return p.pos ? p.pos['XYZ'.indexOf(property.slice(-1))] : null;
    }
    const v = readStat(p.stats, property, rules);
    return v === undefined ? null : v;
  }

  /** health / walkSpeed / jumpPower の設定。受け付けたら true(位置の設定は呼び出し側で「移動の命令」として扱う) */
  setProperty(id, property, value) {
    const p = this.map.get(id);
    return !!p && writeStat(p.stats, property, value);
  }
  damage(id, amount) { const p = this.map.get(id); return !!p && damageStat(p.stats, amount); }
  heal(id, amount) { const p = this.map.get(id); return !!p && healStat(p.stats, amount); }
  respawn(id) {
    const p = this.map.get(id);
    if (!p) return false;
    resetStat(p.stats); p.completed = false; p.active.clear();
    return true;
  }
  complete(id) { const p = this.map.get(id); if (!p) return false; p.completed = true; return true; }

  /** クライアントへ送る状態メッセージ(HP・生存・速度) */
  statMessage(id) {
    const p = this.map.get(id);
    if (!p) return null;
    const s = p.stats;
    return { t: 'g', k: 'stat', h: s.health, mh: s.maxHealth, a: s.alive ? 1 : 0, ws: s.walkSpeed, jp: s.jumpPower };
  }
}

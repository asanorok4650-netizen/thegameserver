// 動くパーツ(spinner / mover)の更新。THREE非依存。時刻 t の関数として姿勢を決めるので、同じ t なら誰の画面でも同じ位置になる。
import { poseAt } from '../behaviors/index.js';

export class Dynamics {
  /** @param collision CollisionWorld(moveItem を持つもの) */
  constructor(collision) {
    this.collision = collision;
    this.list = [];
    this.t = 0;
  }

  get size() { return this.list.length; }

  /**
   * @param e { base:{pos,rot}, behavior, item?:衝突体, trigger?:トリガー(pos/rotを持つ), apply?:(pose)=>void(見た目の更新) }
   */
  add(e) {
    e.pose = poseAt(e.base, e.behavior, 0);
    this.list.push(e);
    return e;
  }

  /**
   * t(秒)の姿勢に更新する。carryItem(プレイヤーが乗っている衝突体)の動きは player に反映する。
   * @param player { x, y, z } を書き換える(Vector3でも可)。無ければ運ばない
   * @returns 乗っている床が回った角度(ラジアン。アバターの向きに足す)
   */
  step(t, carryItem, player) {
    const dt = t - this.t;
    this.t = t;
    let dyaw = 0;
    for (const e of this.list) {
      const prev = e.pose, next = poseAt(e.base, e.behavior, t);
      if (player && carryItem && e.item === carryItem) {
        const b = e.behavior;
        if (b.id === 'mover') {
          player.x += next.pos[0] - prev.pos[0];
          player.y += next.pos[1] - prev.pos[1];
          player.z += next.pos[2] - prev.pos[2];
        } else if (b.id === 'spinner' && b.params.axis === 'y') {
          const th = (b.params.speed * dt * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
          const dx = player.x - prev.pos[0], dz = player.z - prev.pos[2];
          player.x = prev.pos[0] + c * dx + s * dz;
          player.z = prev.pos[2] - s * dx + c * dz;
          dyaw = th;
        }
      }
      e.pose = next;
      if (e.item) this.collision.moveItem(e.item, next.pos, next.rot);
      if (e.trigger) { e.trigger.pos = next.pos.slice(); e.trigger.rot = next.rot.slice(); }
      if (e.apply) e.apply(next);
    }
    return dyaw;
  }
}

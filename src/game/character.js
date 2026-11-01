// 歩行アニメーション(手続き式)。腕・脚(R15は上腕〜手 / 上脚〜足をまとめて)を肩・腰を支点に振る。
import * as THREE from 'three';

const key = (n) => String(n).toLowerCase().replace(/[^a-z]/g, '');
const LIMBS = {
  lArm: /^left(upper|lower)?(arm|hand)$/, rArm: /^right(upper|lower)?(arm|hand)$/,
  lLeg: /^left(upper|lower)?(leg|foot)$/, rLeg: /^right(upper|lower)?(leg|foot)$/
};

/** built = buildAvatar() の戻り値。group の原点は足元の中心。呼ぶと group の中にピボットを作る */
export function makeAnimator(built) {
  built.group.updateMatrixWorld(true);
  const limbs = {};
  for (const name of Object.keys(LIMBS)) {
    const objs = built.parts
      .filter((pt) => !pt.accessory && pt.object.parent === built.group && LIMBS[name].test(key(pt.name)))
      .map((pt) => pt.object);
    if (!objs.length) continue;
    const box = new THREE.Box3();
    for (const o of objs) box.expandByObject(o);
    const pivot = new THREE.Group();
    pivot.position.set((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2);
    built.group.add(pivot);
    pivot.updateMatrixWorld(true);
    for (const o of objs) pivot.attach(o);
    limbs[name] = pivot;
  }
  let phase = 0, amp = 0;
  return {
    found: Object.keys(limbs),
    /** speed: 水平速度(studs/s) */
    update(dt, speed, grounded) {
      phase += dt * speed * 0.55;
      const target = grounded ? Math.min(speed / 16, 1) * 0.85 : 0.25;
      amp += (target - amp) * Math.min(1, dt * 12);
      const s = Math.sin(phase) * amp;
      if (limbs.lLeg) limbs.lLeg.rotation.x = s;
      if (limbs.rLeg) limbs.rLeg.rotation.x = -s;
      if (limbs.lArm) limbs.lArm.rotation.x = grounded ? -s * 0.9 : 2.4 * (1 - amp) + 0.3;
      if (limbs.rArm) limbs.rArm.rotation.x = grounded ? s * 0.9 : 2.4 * (1 - amp) + 0.3;
    }
  };
}

// 歩行アニメーション(手続き式)。腕・脚を肩・腰を支点に振る。
// R15: 関節の入れ子(skeleton.js)に組み替え、標準のKeyframeSequenceを関節に流し込む。
//      アニメが読み込めない状態は、肩・腰の関節を回す手続き式で代用。組み替えに失敗したら従来のピボット方式にする。
// R6 : 腕・脚のメッシュをピボットにまとめて振る。
import * as THREE from 'three';
import { attachRig } from '../avatar/skeleton.js';
import { createAnimate } from './animate.js';
import { posesToCFs } from '../rbx/animation.js';

const key = (n) => String(n).toLowerCase().replace(/[^a-z]/g, '');
const LIMBS = {
  lArm: /^left(upper|lower)?(arm|hand)$/, rArm: /^right(upper|lower)?(arm|hand)$/,
  lLeg: /^left(upper|lower)?(leg|foot)$/, rLeg: /^right(upper|lower)?(leg|foot)$/
};
const R15_ROOTS = { lArm: 'LeftUpperArm', rArm: 'RightUpperArm', lLeg: 'LeftUpperLeg', rLeg: 'RightUpperLeg' };

const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const rotXcf = (a) => ({ pos: [0, 0, 0], rot: [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)] });
/** 待機のアニメが読み込めないときの代用: 息づかい程度の小さな揺れ(約3秒周期) */
function idleSway(t) {
  const b = Math.sin(t * 2.1);
  return {
    UpperTorso: { pos: [0, 0.03 * b, 0], rot: I3 },
    Head: rotXcf(0.04 * b),
    LeftUpperArm: rotXcf(0.06 * b), RightUpperArm: rotXcf(0.06 * b),
  };
}

/** 歩行の位相と振れ幅を進めて、4肢の角度を返す。speed: 水平速度(studs/s) */
function makeGait() {
  let phase = 0, amp = 0;
  return (dt, speed, grounded) => {
    phase += dt * speed * 0.55;
    const target = grounded ? Math.min(speed / 16, 1) * 0.85 : 0.25;
    amp += (target - amp) * Math.min(1, dt * 12);
    const s = Math.sin(phase) * amp;
    return {
      lLeg: s, rLeg: -s,
      lArm: grounded ? -s * 0.9 : 2.4 * (1 - amp) + 0.3,
      rArm: grounded ? s * 0.9 : 2.4 * (1 - amp) + 0.3
    };
  };
}

/** built = buildAvatar() の戻り値。group の原点は足元の中心。R15は group の中に関節ノードを作る */
export function makeAnimator(built) {
  let sk = null;
  if (built.rigType === 'R15' && built.layout) {
    try { sk = attachRig(built.group, built.parts, built.layout, built.scales); built.skeleton = sk; }
    catch (e) { built.rigError = e.message; }
  }
  if (sk) {
    const found = Object.keys(R15_ROOTS).filter((k) => sk.nodes[R15_ROOTS[k]]);
    const gait = makeGait();
    const ctl = createAnimate();
    const posScale = (built.scales && built.scales.height) || 1;
    let mode = null, clock = 0;
    // アバターのアニメーションパック(歩行・ラン・ジャンプ…)→標準アニメの順に読み込む。読み込めるまで/読めない状態は手続き式の振りで代用。
    // 結果はコンソールと、画面のログ(built.onAnimLog があれば)に出す
    const log = (msg) => {
      console.info('[anim]', msg);
      if (built.onAnimLog) built.onAnimLog(/失敗|代用|なし/.test(msg) ? 'warn' : 'ok', `[アニメ] ${msg}`);
    };
    import('../avatar/animations.js').then((m) => m.loadAvatarAnimations(ctl, built.report, undefined, log)).catch((e) => log(`読み込み処理に失敗 - ${e.message}`));
    return {
      found, anim: ctl,
      update(dt, speed, grounded) {
        const poses = ctl.update(dt, speed, grounded);
        if (poses) { sk.setPose(posesToCFs(poses, posScale)); mode = 'clip'; return; }
        const a = gait(dt, speed, grounded);
        if (ctl.state === 'idle') { clock += dt; sk.setPose(idleSway(clock)); mode = 'sway'; return; } // 待機のアニメが無いときの代用
        if (mode !== 'gait') { sk.resetPose(); mode = 'gait'; }
        for (const k of found) sk.swing(R15_ROOTS[k], a[k]);
      }
    };
  }

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
  const gait = makeGait();
  return {
    found: Object.keys(limbs),
    update(dt, speed, grounded) {
      const a = gait(dt, speed, grounded);
      for (const k of Object.keys(limbs)) limbs[k].rotation.x = a[k];
    }
  };
}

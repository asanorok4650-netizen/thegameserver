// R15アバターを関節の入れ子(Motor6D相当)に組み替える。静止姿勢の見た目は変えない。
// 各パーツは「パーツ座標系のノード」の子になり、ノード間の相対行列は C0 * Transform * C1⁻¹(rig15.js)。
// アニメーションは Transform(Pose名=子パーツ名をキーにしたCFrame)を setPose で与えるだけ。
import * as THREE from 'three';
import { buildR15Rig, cfMul, cfInv, describeRig } from './rig15.js';

const toM = (cf) => {
  const r = cf.rot, p = cf.pos;
  return new THREE.Matrix4().set(r[0], r[1], r[2], p[0], r[3], r[4], r[5], p[1], r[6], r[7], r[8], p[2], 0, 0, 0, 1);
};

/**
 * @param group buildAvatar() の group(パーツのメッシュが直接の子)
 * @param parts buildAvatar() の parts([{ name, object, accessory, attachedTo }])
 * @param layout buildAvatar() が使ったR15レイアウト
 * @returns { rig, nodes, setPose(transforms), swing(子パーツ名, 角度), resetPose(), summary }
 */
export function attachRig(group, parts, layout, scales = {}) {
  const rig = buildR15Rig(layout, scales);
  const nodes = {}, joints = {};

  const root = new THREE.Group();
  root.name = 'HumanoidRootPart';
  root.matrixAutoUpdate = false;
  root.matrix.copy(toM(rig.rest.HumanoidRootPart));
  group.add(root);
  nodes.HumanoidRootPart = root;
  for (const j of rig.joints) {
    const parent = nodes[j.part0];
    if (!parent) continue;
    const n = new THREE.Group();
    n.name = j.part1;
    n.matrixAutoUpdate = false;
    const c0 = toM(j.c0), c1i = toM(cfInv(j.c1));
    n.matrix.copy(c0).multiply(c1i);
    parent.add(n);
    nodes[j.part1] = n;
    joints[j.part1] = { j, c0, c1i, node: n };
  }

  // メッシュは、自分のパーツのノードの子にする(ノードの座標系 = パーツの座標系なので、ローカルは単位)
  for (const pt of parts) {
    const o = pt.object;
    if (!o || o.parent !== group) continue;
    if (pt.accessory) { // グループ座標の行列 → 取り付け先パーツの座標へ
      const att = nodes[pt.attachedTo];
      if (!att) continue;
      o.matrix.premultiply(toM(rig.rest[pt.attachedTo]).invert());
      att.add(o);
    } else if (nodes[pt.name]) {
      o.position.set(0, 0, 0);
      o.quaternion.identity();
      nodes[pt.name].add(o);
    }
  }

  const ident = new THREE.Matrix4();
  const apply = (name, T) => {
    const J = joints[name];
    if (!J) return;
    J.node.matrix.copy(J.c0).multiply(T).multiply(J.c1i);
    J.node.matrixWorldNeedsUpdate = true;
  };
  const api = {
    rig, nodes, summary: describeRig(rig),
    /** transforms: { 子パーツ名: CFrame{pos,rot} }。無い関節は静止(単位) */
    setPose(transforms) {
      for (const name of Object.keys(joints)) apply(name, transforms && transforms[name] ? toM(transforms[name]) : ident);
    },
    /** 関節を、ワールドのX軸まわりに angle(rad) だけ回す(親が静止のとき)。他の関節は触らない */
    swing(name, angle) {
      const J = joints[name];
      if (!J) return;
      const F = toM({ pos: [0, 0, 0], rot: cfMul(rig.rest[J.j.part0], J.j.c0).rot });
      apply(name, F.clone().invert().multiply(new THREE.Matrix4().makeRotationX(angle)).multiply(F));
    },
    resetPose() { api.setPose(null); },
  };
  return api;
}

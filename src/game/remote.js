// 他プレイヤーの表示(カプセル+名前ラベル)。初期版は簡易表示で、Robloxアバターへの置き換えは後続。
// 受け取った位置へなめらかに寄せるだけ。衝突・トリガーには関与しない。
import * as THREE from 'three';

const COLORS = [0xff6b6b, 0x4dabf7, 0x69db7c, 0xffd43b, 0xda77f2, 0xffa94d, 0x63e6be, 0xf783ac];
const HEIGHT = 5.3, RADIUS = 0.9;
const colorOf = (id) => COLORS[(parseInt(String(id).replace(/\D/g, ''), 10) || 0) % COLORS.length];

function makeLabel(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.6)';
  g.beginPath(); g.roundRect(4, 8, 248, 48, 20); g.fill();
  g.fillStyle = '#fff'; g.font = 'bold 28px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 33, 232);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(6, 1.5, 1);
  sprite.position.y = HEIGHT + 1.2;
  sprite.renderOrder = 10;
  return sprite;
}

export class RemotePlayers {
  constructor(scene) { this.scene = scene; this.map = new Map(); }

  /** @param list [{ id, name, s:[x,y,z,heading,speed,grounded] }] 載っていないプレイヤーは消す */
  apply(list) {
    const seen = new Set();
    for (const e of list) {
      seen.add(e.id);
      let r = this.map.get(e.id);
      if (!r) {
        const group = new THREE.Group();
        const body = new THREE.Mesh(
          new THREE.CapsuleGeometry(RADIUS, HEIGHT - RADIUS * 2, 4, 12),
          new THREE.MeshLambertMaterial({ color: colorOf(e.id) })
        );
        body.position.y = HEIGHT / 2;
        const nose = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.9), new THREE.MeshLambertMaterial({ color: 0xffffff }));
        nose.position.set(0, HEIGHT * 0.7, -RADIUS); // 前(-Z)を示す
        const label = makeLabel(e.name);
        group.add(body, nose, label);
        group.position.set(e.s[0], e.s[1], e.s[2]);
        group.rotation.y = e.s[3];
        this.scene.add(group);
        r = { group, label, name: e.name, target: e.s };
        this.map.set(e.id, r);
      }
      r.target = e.s;
    }
    for (const [id, r] of this.map) if (!seen.has(id)) { this._dispose(r); this.map.delete(id); }
  }

  update(dt) {
    const a = 1 - Math.exp(-Math.min(dt, 0.1) * 12);
    for (const r of this.map.values()) {
      const t = r.target, p = r.group.position;
      if (Math.hypot(t[0] - p.x, t[1] - p.y, t[2] - p.z) > 20) p.set(t[0], t[1], t[2]); // 大きく離れたら瞬間移動
      else { p.x += (t[0] - p.x) * a; p.y += (t[1] - p.y) * a; p.z += (t[2] - p.z) * a; }
      let d = t[3] - r.group.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      r.group.rotation.y += d * a;
    }
  }

  clear() { for (const r of this.map.values()) this._dispose(r); this.map.clear(); }
  dispose() { this.clear(); }

  _dispose(r) {
    this.scene.remove(r.group);
    r.group.traverse((o) => {
      o.geometry?.dispose?.();
      if (o.material) { o.material.map?.dispose?.(); o.material.dispose(); }
    });
  }
}

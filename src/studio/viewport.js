// Studioの3Dビュー(three)。Reactからは setDoc / setSelection / focus だけ呼ぶ。
// 描画は game/world.js の buildSceneFromWorld(InstancedMesh)をそのまま使い、プレイ時と同じ見た目で編集する。
// 選択・クリック判定は three のレイキャストではなく pick.js(docのparts直接)。
import * as THREE from 'three';
import { buildSceneFromWorld, disposeWorld } from '../game/world.js';
import { pickPart } from './pick.js';
import { docBounds } from './model.js';
import { CONFIG } from '../config.js';

const MAX_OUTLINES = 200; // 選択枠を描く上限(大量選択でも重くならないように)

export class StudioViewport {
  /** @param handlers { onPick(id|null, additive:boolean) } */
  constructor(host, handlers = {}) {
    this.host = host;
    this.h = handlers;
    this.doc = null;
    this.world = null;
    this.selection = [];

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none';
    host.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9ec9ff);
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.5, 6000);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f9c, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-0.4, 1, 0.6);
    this.scene.add(sun);

    this.grid = new THREE.GridHelper(512, 128, 0x5b6b8f, 0x8fa0c8);
    this.grid.material.transparent = true; this.grid.material.opacity = 0.35; this.grid.material.depthWrite = false;
    this.scene.add(this.grid);

    this.overlay = new THREE.Group(); // 選択枠・スポーン印
    this.scene.add(this.overlay);
    this.edge = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.selMat = new THREE.LineBasicMaterial({ color: 0xffa000, depthTest: false });
    this.spawnMat = new THREE.LineBasicMaterial({ color: 0x1fbf6b, depthTest: false });

    this.target = new THREE.Vector3(0, 2, 0);
    this.yaw = 0.8; this.pitch = 0.55; this.dist = 40;
    this.pointers = new Map();
    this.gesture = null;
    this.dirty = true;

    const el = this.renderer.domElement;
    this._down = (e) => this.pointerDown(e);
    this._move = (e) => this.pointerMove(e);
    this._up = (e) => this.pointerUp(e);
    this._wheel = (e) => { e.preventDefault(); this.zoom(Math.sign(e.deltaY) * 0.1); };
    this._ctx = (e) => e.preventDefault();
    el.addEventListener('pointerdown', this._down);
    el.addEventListener('pointermove', this._move);
    el.addEventListener('pointerup', this._up);
    el.addEventListener('pointercancel', this._up);
    el.addEventListener('wheel', this._wheel, { passive: false });
    el.addEventListener('contextmenu', this._ctx);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  // ---- 状態の反映 ----
  /** ドキュメントを反映。同じ参照なら何もしない。再構築は次のフレームでまとめて1回 */
  setDoc(doc) {
    if (doc === this.doc) return;
    this.doc = doc;
    this.rebuildPending = true;
    this.dirty = true;
  }

  setSelection(ids) {
    this.selection = ids;
    this.outlinesPending = true;
    this.dirty = true;
  }

  getTarget() { return [this.target.x, this.target.y, this.target.z]; }

  /** 全体が見えるようにカメラを合わせる(パーツがなければ原点) */
  focusAll() {
    if (!this.doc || !this.doc.parts.length) { this.target.set(0, 2, 0); this.dist = 40; this.dirty = true; return; }
    const b = docBounds(this.doc);
    this.target.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    const r = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2;
    this.dist = Math.min(3000, Math.max(12, r * 1.6));
    this.dirty = true;
  }

  focusSelection() {
    const sel = new Set(this.selection);
    const ps = this.doc ? this.doc.parts.filter((p) => sel.has(p.id)) : [];
    if (!ps.length) return this.focusAll();
    const c = [0, 0, 0]; let r = 0;
    for (const p of ps) for (let i = 0; i < 3; i++) c[i] += p.pos[i] / ps.length;
    for (const p of ps) r = Math.max(r, Math.hypot(p.pos[0] - c[0], p.pos[1] - c[1], p.pos[2] - c[2]) + Math.hypot(...p.size) / 2);
    this.target.set(c[0], c[1], c[2]);
    this.dist = Math.min(3000, Math.max(8, r * 2.2));
    this.dirty = true;
  }

  // ---- カメラ操作 ----
  zoom(f) { this.dist = Math.min(3000, Math.max(3, this.dist * (1 + f))); this.dirty = true; }

  pan(dx, dy) {
    const k = this.dist * 0.0016;
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.target.addScaledVector(right, -dx * k).addScaledVector(fwd, dy * k);
    this.dirty = true;
  }

  pointerDown(e) {
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this.gesture = { mode: e.button === 2 || e.shiftKey ? 'pan' : 'orbit', sx: e.clientX, sy: e.clientY, moved: 0, t: performance.now(), shift: e.shiftKey || e.ctrlKey || e.metaKey };
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.gesture = { mode: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, moved: 99 };
    }
  }

  pointerMove(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p || !this.gesture) return;
    const g = this.gesture;
    if (g.mode === 'pinch' && this.pointers.size === 2) {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      if (g.d > 0) this.zoom(g.d / d - 1);
      this.pan(cx - g.cx, cy - g.cy);
      g.d = d; g.cx = cx; g.cy = cy;
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    g.moved += Math.abs(dx) + Math.abs(dy);
    if (g.mode === 'orbit') {
      this.yaw -= dx * 0.007;
      this.pitch = Math.min(1.5, Math.max(-0.1, this.pitch + dy * 0.007));
      this.dirty = true;
    } else if (g.mode === 'pan') this.pan(dx, dy);
  }

  pointerUp(e) {
    const g = this.gesture;
    this.pointers.delete(e.pointerId);
    if (g && g.mode !== 'pinch' && g.moved < 6 && performance.now() - g.t < 500 && e.type === 'pointerup') this.click(e.clientX, e.clientY, g.shift);
    if (this.pointers.size === 0) this.gesture = null;
    else if (this.pointers.size === 1) { const [q] = [...this.pointers.values()]; this.gesture = { mode: 'orbit', sx: q.x, sy: q.y, moved: 99, t: 0, shift: false }; }
  }

  click(cx, cy, additive) {
    if (!this.doc) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = pickPart(this.doc.parts, [ray.ray.origin.x, ray.ray.origin.y, ray.ray.origin.z], [ray.ray.direction.x, ray.ray.direction.y, ray.ray.direction.z]);
    if (this.h.onPick) this.h.onPick(hit ? hit.id : null, !!additive);
  }

  // ---- 描画 ----
  resize() {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.pixelRatioCap));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  _rebuildWorld() {
    if (this.world) { this.scene.remove(this.world.group); disposeWorld(this.world); this.world = null; }
    const doc = this.doc;
    if (!doc || !doc.parts.length) return;
    this.world = buildSceneFromWorld({ parts: doc.parts, spawns: doc.spawns });
    this.scene.add(this.world.group);
  }

  _matrix(pos, rot, size) {
    const m = new THREE.Matrix4().set(rot[0], rot[1], rot[2], pos[0], rot[3], rot[4], rot[5], pos[1], rot[6], rot[7], rot[8], pos[2], 0, 0, 0, 1);
    return m.multiply(new THREE.Matrix4().makeScale(size[0], size[1], size[2]));
  }

  _rebuildOverlay() {
    for (const c of [...this.overlay.children]) this.overlay.remove(c); // ジオメトリ/マテリアルは共有なので破棄しない
    if (!this.doc) return;
    const ident = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    for (const s of this.doc.spawns) {
      const l = new THREE.LineSegments(this.edge, this.spawnMat);
      l.matrixAutoUpdate = false; l.matrix.copy(this._matrix(s.pos, ident, [s.size[0], Math.max(s.size[1], 0.4), s.size[2]]));
      l.renderOrder = 10; this.overlay.add(l);
    }
    const sel = new Set(this.selection);
    let n = 0;
    for (const p of this.doc.parts) {
      if (!sel.has(p.id)) continue;
      if (n++ >= MAX_OUTLINES) break;
      const l = new THREE.LineSegments(this.edge, this.selMat);
      l.matrixAutoUpdate = false; l.matrix.copy(this._matrix(p.pos, p.rot, p.size));
      l.renderOrder = 11; this.overlay.add(l);
    }
  }

  tick() {
    if (this.rebuildPending) { this.rebuildPending = false; this._rebuildWorld(); this.outlinesPending = true; this.dirty = true; }
    if (this.outlinesPending) { this.outlinesPending = false; this._rebuildOverlay(); this.dirty = true; }
    if (!this.dirty) return; // 変化がなければ描画しない(バッテリー節約)
    this.dirty = false;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.camera.position.set(
      this.target.x + this.dist * cp * Math.sin(this.yaw),
      this.target.y + this.dist * sp,
      this.target.z + this.dist * cp * Math.cos(this.yaw)
    );
    this.camera.lookAt(this.target);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.ro.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this._down);
    el.removeEventListener('pointermove', this._move);
    el.removeEventListener('pointerup', this._up);
    el.removeEventListener('pointercancel', this._up);
    el.removeEventListener('wheel', this._wheel);
    el.removeEventListener('contextmenu', this._ctx);
    if (this.world) disposeWorld(this.world);
    this.edge.dispose(); this.selMat.dispose(); this.spawnMat.dispose();
    this.grid.geometry.dispose(); this.grid.material.dispose();
    this.renderer.dispose();
    if (el.parentNode) el.parentNode.removeChild(el);
  }
}

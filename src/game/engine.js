// ゲーム本体: シーン・プレイヤー(歩行/ジャンプ/衝突)・三人称カメラ。UIからは setMove/look/setJump を呼ぶ。
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { disposeObject } from '../avatar/builder.js';
import { makeAnimator } from './character.js';
import { disposeWorld } from './world.js';

const WALK = 16, JUMP = 50, GRAVITY = 196.2, RADIUS = 0.9; // Robloxの既定値(studs)
const KEYMAP = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r' };

export class Game {
  constructor(host) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none';
    host.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9ec9ff);
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.5, 4000);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f9c, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-0.4, 1, 0.6);
    this.scene.add(sun);

    this.p = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0.35; this.dist = 14;
    this.heading = 0;
    this.grounded = false;
    this.height = 5.3;
    this.sy = [RADIUS, 2.65, 4.4];
    this.keys = new Set();
    this.joy = { x: 0, y: 0 };
    this.jumpHeld = false;
    this.world = null; this.collision = null; this.spawn = [0, 10, 0]; this.logic = null;
    this.holder = null; this.avatar = null; this.anim = null;
    this.last = performance.now();
    this.minY = -500;

    this._onKey = (e) => this._key(e, true);
    this._onKeyUp = (e) => this._key(e, false);
    this._onWheel = (e) => { e.preventDefault(); this.dist = Math.min(60, Math.max(4, this.dist * (1 + Math.sign(e.deltaY) * 0.1))); };
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('keyup', this._onKeyUp);
    this.renderer.domElement.addEventListener('wheel', this._onWheel, { passive: false });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  _key(e, down) {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.code === 'Space') { this.jumpHeld = down; e.preventDefault(); return; }
    const k = KEYMAP[e.code];
    if (!k) return;
    if (down) this.keys.add(k); else this.keys.delete(k);
    e.preventDefault();
  }

  resize() {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.pixelRatioCap));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setMove(x, y) { this.joy.x = x; this.joy.y = y; }   // y: 前が正
  setJump(v) { this.jumpHeld = !!v; }
  look(dx, dy) {
    this.yaw -= dx * 0.006;
    this.pitch = Math.min(1.35, Math.max(-0.2, this.pitch + dy * 0.006));
  }

  setLogic(logic) { this.logic = logic || null; }

  setWorld(world) {
    this.world = world; this.collision = world.collision; this.spawn = world.spawn;
    this.scene.add(world.group);
    const b = world.collision.bounds();
    this.minY = b ? Math.min(-500, b.min[1] - 300) : -500;
    this.respawn();
  }

  /** built = buildAvatar() の戻り値 */
  setAvatar(built) {
    if (this.holder) { this.scene.remove(this.holder); disposeObject(this.holder); }
    const H = Math.max(3, built.box.max.y - built.box.min.y);
    this.height = H;
    this.sy = [RADIUS, H / 2, H - RADIUS];
    this.anim = makeAnimator(built);
    built.group.position.y = -built.box.min.y; // 足元を原点に
    this.holder = new THREE.Group();
    this.holder.add(built.group);
    this.scene.add(this.holder);
    this.avatar = built;
  }

  respawn() {
    this.p.set(this.spawn[0], this.spawn[1], this.spawn[2]);
    this.vel.set(0, 0, 0);
  }

  _resolve() {
    const c = this.collision, pt = [0, 0, 0];
    let up = false, ceil = false;
    for (const y of this.sy) {
      pt[0] = this.p.x; pt[1] = this.p.y + y; pt[2] = this.p.z;
      if (c.pushOut(pt, RADIUS)) {
        this.p.set(pt[0], pt[1] - y, pt[2]);
        if (c.maxNy > 0.5) up = true;
        if (c.minNy < -0.5) ceil = true;
      }
    }
    return { up, ceil };
  }

  update(dt) {
    dt = Math.min(dt, 0.05);
    const k = this.keys;
    let mx = this.joy.x + (k.has('r') ? 1 : 0) - (k.has('l') ? 1 : 0);
    let my = this.joy.y + (k.has('f') ? 1 : 0) - (k.has('b') ? 1 : 0);
    const len = Math.hypot(mx, my);
    if (len < 0.15) { mx = 0; my = 0; } else if (len > 1) { mx /= len; my /= len; }
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const wx = -sy * my + cy * mx, wz = -cy * my - sy * mx; // カメラ基準の前/右
    this.vel.x = wx * WALK; this.vel.z = wz * WALK;
    if (this.grounded && this.jumpHeld) { this.vel.y = JUMP; this.grounded = false; }
    this.vel.y -= GRAVITY * dt;

    const dist = Math.max(Math.abs(this.vel.x), Math.abs(this.vel.y), Math.abs(this.vel.z)) * dt;
    const steps = Math.max(1, Math.ceil(dist / 0.4)); // すり抜け防止: 1回の移動を0.4studs以下に分割
    let grounded = false;
    for (let i = 0; i < steps; i++) {
      this.p.addScaledVector(this.vel, dt / steps);
      if (this.collision) {
        const r = this._resolve();
        if (r.up) { grounded = true; if (this.vel.y < 0) this.vel.y = 0; }
        if (r.ceil && this.vel.y > 0) this.vel.y = 0;
      }
    }
    this.grounded = grounded;
    if (this.p.y < this.minY) this.respawn();

    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (mx !== 0 || my !== 0) {
      const target = Math.atan2(-wx, -wz);
      let d = target - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * Math.min(1, dt * 14);
    }
    if (this.holder) {
      this.holder.position.copy(this.p);
      this.holder.rotation.y = this.heading;
      if (this.anim) this.anim.update(dt, speed, this.grounded);
    }
  }

  tick() {
    const now = performance.now();
    const dt = (now - this.last) / 1000;
    this.last = now;
    if (this.world) this.update(dt);
    const cp = Math.cos(this.pitch);
    const tx = this.p.x, ty = this.p.y + this.height * 0.75, tz = this.p.z;
    this.camera.position.set(tx + Math.sin(this.yaw) * cp * this.dist, ty + Math.sin(this.pitch) * this.dist, tz + Math.cos(this.yaw) * cp * this.dist);
    this.camera.lookAt(tx, ty, tz);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.ro.disconnect();
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('keyup', this._onKeyUp);
    this.renderer.domElement.removeEventListener('wheel', this._onWheel);
    if (this.holder) { this.scene.remove(this.holder); disposeObject(this.holder); }
    if (this.world) { this.scene.remove(this.world.group); disposeWorld(this.world); }
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}

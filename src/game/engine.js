// ゲーム本体: シーン・プレイヤー(歩行/ジャンプ/衝突)・三人称カメラ。
// ゲーム固有のルールは logics/ の Runtime に委譲する。
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { disposeObject } from '../avatar/builder.js';
import { makeAnimator } from './character.js';
import { disposeWorld } from './world.js';
import { sphereIntersectsOBB } from './collision.js';
import { createLogicRuntime } from '../logics/index.js';
import { createProgramIR } from '../scripting/ir.js';
import { resolveRules, defaultRules, defaultEnvironment } from './rules.js';
import { createScriptingRuntime } from '../scripting/runtime.js';

const RADIUS = 0.9; // 歩く速さ・ジャンプ力・重力は manifest.rules(game.rules)から取る
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
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8a8f9c, 1.5);
    this.scene.add(this.hemi);
    this.sunLight = new THREE.DirectionalLight(0xffffff, 1.6);
    this.sunLight.position.set(-0.4, 1, 0.6);
    this.scene.add(this.sunLight);
    this.rules = defaultRules();
    this.floor = null;
    this.time = 0; // 動くパーツ用の経過時間(秒)。世界の時計なので復活・やり直しでは戻さない
    this.setEnvironment(defaultEnvironment());

    this.p = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    // M1-D: 現行は単一ローカルプレイヤー。APIはIDを必須にし、将来の複数プレイヤー管理へ拡張する。
    this.playerStats = { health: 100, maxHealth: 100, alive: true, walkSpeed: null, jumpPower: null };
    this.yaw = 0; this.pitch = 0.35; this.dist = 14;
    this.heading = 0;
    this.grounded = false;
    this.height = 5.3;
    this.sy = [RADIUS, 2.65, 4.4];
    this.keys = new Set();
    this.joy = { x: 0, y: 0 };
    this.jumpHeld = false;
    this.world = null; this.collision = null; this.spawn = [0, 10, 0]; this.initialSpawn = this.spawn.slice();
    this.logic = null; this.logicRuntime = null; this.logicHandlers = {};
    this.eventRulesConfig = []; this.eventRuleHandlers = {}; this.activeRuleTriggers = new Set();
    this.scriptingWorkspace = null; this.scriptRuntime = null; this.scriptHandlers = {};
    this.activeTriggers = new Set(); this.completed = false;
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
    if (this.completed) return;
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

  setMove(x, y) { if (!this.completed) { this.joy.x = x; this.joy.y = y; } }
  setJump(v) { if (!this.completed) this.jumpHeld = !!v; }
  look(dx, dy) {
    this.yaw -= dx * 0.006;
    this.pitch = Math.min(1.35, Math.max(-0.2, this.pitch + dy * 0.006));
  }

  /** manifest.rules(生の値でもよい。範囲外は丸められる) */
  setRules(raw) { this.rules = resolveRules(raw); }

  /** world.json の environment を resolveEnvironment した値 */
  setEnvironment(env) {
    this.scene.background = new THREE.Color(env.skyColor);
    this.hemi.intensity = env.ambient;
    this.sunLight.intensity = env.sun;
    this.scene.fog = env.fogFar > 0 ? new THREE.Fog(new THREE.Color(env.fogColor), env.fogNear, env.fogFar) : null;
  }

  setLogic(logic, handlers = {}) {
    this.logic = logic || null;
    this.logicHandlers = handlers;
    this.logicRuntime = createLogicRuntime(this.logic, {
      respawn: (player = 'local') => this.respawn(player),
      setCheckpoint: (position) => { this.spawn = position.slice(); },
      complete: () => {
        this.completed = true;
        this.keys.clear();
        this.joy.x = 0; this.joy.y = 0; this.jumpHeld = false;
        this.vel.set(0, 0, 0);
        this.logicHandlers.onComplete?.();
      }
    });
  }

  setScripting(workspace, handlers = {}) {
    this.scriptingWorkspace = workspace || null;
    this.scriptHandlers = handlers;
    if (this.world) this._createUnifiedRuntime();
  }

  setEventRules(rules, handlers = {}) {
    this.eventRulesConfig = Array.isArray(rules) ? rules : [];
    this.eventRuleHandlers = handlers;
    if (this.world) this._createUnifiedRuntime();
  }

  _createUnifiedRuntime() {
    const program = createProgramIR({ workspace: this.scriptingWorkspace, eventRules: this.eventRulesConfig });
    const handlers = { ...this.eventRuleHandlers, ...this.scriptHandlers };
    if (program.errors?.length) handlers.onWarning?.('スクリプトのコンパイル警告: ' + program.errors.join(' / '));
    const parts = this.world?.ruleParts || [];
    const findPart = (key) => parts.find((p) => p.id === key || p.name === key);
    const atPart = (key) => {
      const part = findPart(key);
      if (!part) { handlers.onWarning?.('対象パーツが見つかりません: ' + key); return null; }
      return [part.pos[0], part.pos[1] + part.size[1] / 2 + 0.2, part.pos[2]];
    };
    this.scriptRuntime?.stop?.();
    this.scriptRuntime = createScriptingRuntime(program, {
      onScore: handlers.onScore,
      onMessage: handlers.onMessage,
      onWarning: handlers.onWarning,
      setCheckpoint: () => { this.spawn = [this.p.x, this.p.y, this.p.z]; },
      teleportToPart: (key, player = 'local') => { if (player !== 'local') return false; const p = atPart(key); if (!p) return false; this.p.set(...p); this.vel.set(0,0,0); this.grounded = false; return true; },
      checkpointAtPart: (key) => { const p = atPart(key); if (p) this.spawn = p; },
      respawn: () => this.respawn(),
      complete: () => {
        this.completed = true; this.keys.clear(); this.joy.x = 0; this.joy.y = 0;
        this.jumpHeld = false; this.vel.set(0,0,0); this.logicHandlers.onComplete?.();
      },
      setPartVisible: (key, visible) => { if (!this.world?.setPartVisible?.(key, visible)) handlers.onWarning?.('表示を変更するパーツが見つかりません: ' + key); },
      movePart: (key, position) => { if (!this.world?.movePart?.(key, position)) handlers.onWarning?.('移動するパーツが見つからないか、座標が不正です: ' + key); },
      setPartProperty: (key, property, value) => this.world?.setPartProperty?.(key, property, value) ?? false,
      getPartProperty: (key, property) => this.world?.getPartProperty?.(key, property) ?? null,
      getPlayerProperty: (player, property) => this.getPlayerProperty(player, property),
      setPlayerProperty: (player, property, value) => this.setPlayerProperty(player, property, value),
      damagePlayer: (player, amount) => this.damagePlayer(player, amount),
      healPlayer: (player, amount) => this.healPlayer(player, amount)
    });
    this.scriptRuntime.start();
  }

  setWorld(world) {
    this.world = world; this.collision = world.collision;
    if (world.environment) this.setEnvironment(world.environment);
    this.spawn = world.spawn.slice(); this.initialSpawn = world.spawn.slice();
    this._createUnifiedRuntime();
    this.scene.add(world.group);
    const b = world.collision.bounds();
    this.minY = b ? Math.min(-500, b.min[1] - 300) : -500;
    this.respawn();
  }

  setAvatar(built) {
    if (this.holder) { this.scene.remove(this.holder); disposeObject(this.holder); }
    const H = Math.max(3, built.box.max.y - built.box.min.y);
    this.height = H;
    this.sy = [RADIUS, H / 2, H - RADIUS];
    this.anim = makeAnimator(built);
    built.group.position.y = -built.box.min.y;
    this.holder = new THREE.Group();
    this.holder.add(built.group);
    this.scene.add(this.holder);
    this.avatar = built;
  }

  getPlayerProperty(player, property) {
    if (player !== 'local') return null;
    const values = {
      health: this.playerStats.health, maxHealth: this.playerStats.maxHealth, alive: this.playerStats.alive,
      positionX: this.p.x, positionY: this.p.y, positionZ: this.p.z,
      walkSpeed: this.playerStats.walkSpeed ?? this.rules.walkSpeed,
      jumpPower: this.playerStats.jumpPower ?? this.rules.jumpPower
    };
    return Object.hasOwn(values, property) ? values[property] : null;
  }

  setPlayerProperty(player, property, value) {
    if (player !== 'local') return false;
    if (property === 'position') return this.setPlayerPosition(player, value);
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    if (property === 'health') {
      this.playerStats.health = Math.max(0, Math.min(this.playerStats.maxHealth, value));
      this.playerStats.alive = this.playerStats.health > 0;
      if (!this.playerStats.alive) { this.vel.set(0, 0, 0); this.grounded = false; this.keys.clear(); this.joy.x = 0; this.joy.y = 0; this.jumpHeld = false; }
      return true;
    }
    if (property === 'walkSpeed') { this.playerStats.walkSpeed = Math.max(0, Math.min(200, value)); return true; }
    if (property === 'jumpPower') { this.playerStats.jumpPower = Math.max(0, Math.min(200, value)); return true; }
    return false;
  }

  setPlayerPosition(player, position) {
    if (player !== 'local' || !Array.isArray(position) || position.length !== 3 || !position.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 100000)) return false;
    this.p.set(position[0], position[1], position[2]);
    this.vel.set(0, 0, 0);
    this.grounded = false;
    return true;
  }

  damagePlayer(player, amount) {
    if (player !== 'local' || !this.playerStats.alive || !Number.isFinite(amount)) return false;
    this.playerStats.health = Math.max(0, this.playerStats.health - Math.max(0, amount));
    this.playerStats.alive = this.playerStats.health > 0;
    if (!this.playerStats.alive) { this.vel.set(0, 0, 0); this.grounded = false; this.keys.clear(); this.joy.x = 0; this.joy.y = 0; this.jumpHeld = false; }
    return true;
  }

  healPlayer(player, amount) {
    if (player !== 'local' || !this.playerStats.alive || !Number.isFinite(amount)) return false;
    this.playerStats.health = Math.min(this.playerStats.maxHealth, this.playerStats.health + Math.max(0, amount));
    return true;
  }

  respawn(player = 'local') {
    if (player !== 'local') return false;
    this.playerStats.health = this.playerStats.maxHealth;
    this.playerStats.alive = true;
    this.p.set(this.spawn[0], this.spawn[1], this.spawn[2]);
    this.vel.set(0, 0, 0);
    this.grounded = false;
    this.activeTriggers.clear();
    this.activeRuleTriggers.clear();
    this.scriptRuntime?.onSpawn('local');
    return true;
  }

  restart() {
    this.completed = false;
    this.spawn = this.initialSpawn.slice();
    this.logicRuntime?.reset?.();
    this.scriptRuntime?.reset?.();
    this.scriptRuntime?.start();
    this.keys.clear();
    this.joy.x = 0; this.joy.y = 0; this.jumpHeld = false;
    this.respawn();
    this.logicHandlers.onRestart?.();
  }

  _resolve() {
    const c = this.collision;
    const position = [this.p.x, this.p.y, this.p.z];
    const collided = c.pushOutCapsule(position, RADIUS, RADIUS, this.height - RADIUS);
    this.p.set(position[0], position[1], position[2]);
    return { up: collided && c.maxNy > 0.5, ceil: collided && c.minNy < -0.5 };
  }

  _checkTriggers() {
    if ((!this.logicRuntime && !this.scriptRuntime) || !this.world?.triggers?.length && !this.world?.ruleTriggers?.length || this.completed) return;
    const now = new Set();
    for (const trigger of this.world.triggers) {
      if (trigger.enabled === false) continue;
      let touching = false;
      for (const y of this.sy) {
        if (sphereIntersectsOBB([this.p.x, this.p.y + y, this.p.z], RADIUS, trigger)) {
          touching = true;
          break;
        }
      }
      if (!touching) continue;
      now.add(trigger.id);
      if (this.logicRuntime && !this.activeTriggers.has(trigger.id)) {
        for (const tag of trigger.tags) {
          this.logicRuntime.onContact({ tag, part: trigger, position: this.p });
          if (this.completed) break;
        }
      }
      if (this.completed) break;
    }
    this.activeTriggers = now;
    if (this.scriptRuntime && this.world?.ruleTriggers?.length) {
      const active = new Set();
      for (const trigger of this.world.ruleTriggers) {
        if (trigger.enabled === false) { if (this.activeRuleTriggers.has(trigger.id)) this.scriptRuntime.onLeave(trigger, 'local'); continue; }
        let touching = false;
        for (const y of this.sy) if (sphereIntersectsOBB([this.p.x, this.p.y + y, this.p.z], RADIUS, trigger)) { touching = true; break; }
        if (touching) { active.add(trigger.id); if (!this.activeRuleTriggers.has(trigger.id)) this.scriptRuntime.onTouch(trigger, 'local'); }
        else if (this.activeRuleTriggers.has(trigger.id)) this.scriptRuntime.onLeave(trigger, 'local');
      }
      this.activeRuleTriggers = active;
    }
  }

  update(dt) {
    dt = Math.min(dt, 0.05);
    if (this.completed) return;
    this.time += dt;
    if (!this.playerStats.alive) {
      this.vel.set(0, 0, 0);
      this.logicRuntime?.update?.({ position: this.p, dt });
      this.scriptRuntime?.update?.(dt);
      return;
    }
    // 動くパーツを先に進め、乗っているプレイヤーも一緒に運ぶ(衝突解決の前)
    if (this.world?.dynamics?.size) {
      const dyaw = this.world.dynamics.step(this.time, this.floor, this.p);
      if (dyaw) this.heading += dyaw;
    }
    const k = this.keys;
    let mx = this.joy.x + (k.has('r') ? 1 : 0) - (k.has('l') ? 1 : 0);
    let my = this.joy.y + (k.has('f') ? 1 : 0) - (k.has('b') ? 1 : 0);
    const len = Math.hypot(mx, my);
    if (len < 0.15) { mx = 0; my = 0; } else if (len > 1) { mx /= len; my /= len; }
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const wx = -sy * my + cy * mx, wz = -cy * my - sy * mx;
    const { gravity } = this.rules;
    const walkSpeed = this.playerStats.walkSpeed ?? this.rules.walkSpeed;
    const jumpPower = this.playerStats.jumpPower ?? this.rules.jumpPower;
    this.vel.x = wx * walkSpeed; this.vel.z = wz * walkSpeed;
    const floor = this.grounded ? this.floor : null;
    if (floor?.effect?.type === 'conveyor') { // 足場の向き(X方向)へ運ぶ。回る床でも今の向きに追従する
      const R = floor.rot, h = Math.hypot(R[0], R[6]) || 1;
      this.vel.x += (R[0] / h) * floor.effect.speed; this.vel.z += (R[6] / h) * floor.effect.speed;
    }
    if (this.grounded && this.jumpHeld) { this.vel.y = jumpPower; this.grounded = false; }
    this.vel.y -= gravity * dt;

    const dist = Math.max(Math.abs(this.vel.x), Math.abs(this.vel.y), Math.abs(this.vel.z)) * dt;
    const steps = Math.max(1, Math.ceil(dist / 0.4));
    let grounded = false, floorNow = null;
    for (let i = 0; i < steps; i++) {
      this.p.addScaledVector(this.vel, dt / steps);
      if (this.collision) {
        const r = this._resolve();
        if (r.up) {
          const landed = this.collision.groundItem;
          if (landed?.effect?.type === 'bounce' && this.vel.y <= 0) { this.vel.y = landed.effect.power; continue; } // 跳ねる(接地扱いにしない)
          grounded = true; floorNow = landed; if (this.vel.y < 0) this.vel.y = 0;
        }
        if (r.ceil && this.vel.y > 0) this.vel.y = 0;
      }
    }
    this.grounded = grounded;
    this.floor = grounded ? floorNow : null; // 今乗っている衝突体(動く床・コンベア用)
    this._checkTriggers();
    this.logicRuntime?.update?.({ position: this.p, dt });
    this.scriptRuntime?.update?.(dt);
    if (this.holder) {
      this.holder.position.copy(this.p);
      this.holder.rotation.y = this.heading;
      const speed = Math.hypot(this.vel.x, this.vel.z);
      if (this.anim) this.anim.update(dt, speed, this.grounded);
    }
    if (mx !== 0 || my !== 0) {
      const target = Math.atan2(-wx, -wz);
      let d = target - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * Math.min(1, dt * 14);
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
    this.scriptRuntime?.stop?.();
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

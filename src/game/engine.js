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
import { RemotePlayers } from './remote.js';
import { PlayerRegistry } from './players.js';
import { newStats, writeStat, damageStat, healStat, resetStat } from './playerstats.js';
import { validGameMsg } from '../net/appmsg.js';
import { createBloom } from './bloom.js';

const REMOTE_SY = [0.9, 2.65, 4.4]; // 他のプレイヤーの接触判定の高さ(アバターの大きさは届かないので既定の体格)
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
    this.bloom = createBloom(this.renderer, this.scene, this.camera); // CONFIG.bloom が false なら null(従来の描画)
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8a8f9c, 1.5);
    this.scene.add(this.hemi);
    this.sunLight = new THREE.DirectionalLight(0xffffff, 1.6);
    this.sunLight.position.set(-0.4, 1, 0.6);
    this.scene.add(this.sunLight);
    this.rules = defaultRules();
    this.floor = null;
    this.time = 0; // 動くパーツ用の経過時間(秒)。世界の時計なので復活・やり直しでは戻さない
    this.clockOrigin = performance.now(); // 世界時刻の起点。フレームのdtではなく実時間で数える(低FPS・クリア後・裏画面でも進む)
    this.setEnvironment(defaultEnvironment());
    this.remote = new RemotePlayers(this.scene); // マルチプレイ: 他プレイヤーの表示
    this.netClock = null; // マルチプレイ(クライアント): ホストの世界時刻(秒)を返す関数。null なら自分の時計だけ
    this.localId = 'local'; this.netRole = 'solo'; this.net = null; // netRole: 'solo' | 'host' | 'client'(setNet)
    this.players = new PlayerRegistry(); // ホスト: 他のプレイヤーの状態
    this.partOverrides = new Map(); this._partOut = new Map(); this._netFlushAt = 0; // スクリプトで変えたパーツ(途中参加者・クライアントへ配る)

    this.p = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    // M1-D: 現行は単一ローカルプレイヤー。APIはIDを必須にし、将来の複数プレイヤー管理へ拡張する。
    this.playerStats = newStats();
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
    const pixelRatio = Math.min(window.devicePixelRatio || 1, CONFIG.pixelRatioCap);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(w, h, false);
    this.bloom?.setSize(w, h, pixelRatio);
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
      complete: () => this._completeLocal()
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
      // マルチプレイ(ホスト)では、スコアとメッセージは全員へ配る
      onScore: (score, amount, playerId) => { handlers.onScore?.(score, amount, playerId); this._sendAll({ t: 'g', k: 'score', v: score, d: amount }); },
      onMessage: (text) => { handlers.onMessage?.(text); this._sendAll({ t: 'g', k: 'msg', text }); },
      onWarning: handlers.onWarning,
      stopsOnComplete: () => this.netRole !== 'host', // ホストでは、あるプレイヤーのクリアでスクリプト全体を止めない
      setCheckpoint: (player = 'local') => {
        const pos = this._isLocal(player) ? [this.p.x, this.p.y, this.p.z] : this.players.get(player)?.pos;
        if (pos) this._setCheckpoint(player, pos);
      },
      teleportToPart: (key, player = 'local') => { const p = atPart(key); return p ? this.setPlayerPosition(player, p) : false; },
      checkpointAtPart: (key, player = 'local') => { const p = atPart(key); if (p) this._setCheckpoint(player, p); },
      respawn: (player = 'local') => this.respawn(player),
      complete: (player = 'local') => this._completePlayer(player),
      setPartVisible: (key, visible) => {
        if (!this.world?.setPartVisible?.(key, visible)) handlers.onWarning?.('表示を変更するパーツが見つかりません: ' + key);
        else this._queuePart(key, 'visible', !!visible);
      },
      movePart: (key, position) => {
        if (!this.world?.movePart?.(key, position)) handlers.onWarning?.('移動するパーツが見つからないか、座標が不正です: ' + key);
        else this._queuePart(key, 'move', position);
      },
      setPartProperty: (key, property, value) => {
        const ok = this.world?.setPartProperty?.(key, property, value) ?? false;
        if (ok) this._queuePart(key, property, value);
        return ok;
      },
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

  /** 世界時刻(秒)。マルチプレイのクライアントならホストの時刻、そうでなければこの端末の実時間 */
  worldTime() {
    const hostTime = this.netClock?.();
    return hostTime != null ? hostTime : (performance.now() - this.clockOrigin) / 1000;
  }

  /** マルチプレイで送る自分の状態: [x, y, z, 向き, 速さ, 接地] */
  getNetState() {
    return [this.p.x, this.p.y, this.p.z, this.heading, Math.hypot(this.vel.x, this.vel.z), this.grounded ? 1 : 0];
  }

  // ── プレイヤー(ローカル + マルチプレイ) ──
  // ローカルは this.p / this.playerStats。マルチプレイのホストは、他のプレイヤーを this.players(PlayerRegistry)に持つ。
  // IDは 'local'(または自分のネットワークID)がローカル、this.players にあるIDがリモート(ホストのみ)。クライアントはスクリプトを動かさない。
  _lid() { return this.localId || 'local'; }
  _isLocal(id) { return id === 'local' || (!!this.localId && id === this.localId); }
  _isRemote(id) { return this.netRole === 'host' && !!this.players?.has(id); }
  _handlers() { return { ...this.eventRuleHandlers, ...this.scriptHandlers }; }

  _onLocalDeath() {
    this.vel.set(0, 0, 0); this.grounded = false; this.keys.clear();
    this.joy.x = 0; this.joy.y = 0; this.jumpHeld = false;
  }

  _completeLocal() {
    this.completed = true; this.keys.clear(); this.joy.x = 0; this.joy.y = 0;
    this.jumpHeld = false; this.vel.set(0, 0, 0); this.logicHandlers.onComplete?.();
  }

  /** スクリプトの complete: ローカルならその場でクリア、リモート(ホストのみ)ならそのプレイヤーへ知らせる */
  _completePlayer(player) {
    if (this._isLocal(player)) { this._completeLocal(); return true; }
    if (!this._isRemote(player)) return false;
    this.players.complete(player);
    this._sendTo(player, { t: 'g', k: 'done' });
    return true;
  }

  _setCheckpoint(player, position) {
    if (!Array.isArray(position)) return false;
    if (this._isLocal(player)) { this.spawn = position.slice(); return true; }
    if (!this._isRemote(player)) return false;
    this._sendTo(player, { t: 'g', k: 'cp', pos: position.slice() });
    return true;
  }

  getPlayerProperty(player, property) {
    if (!this._isLocal(player)) return this._isRemote(player) ? this.players.getProperty(player, property, this.rules) : null;
    const values = {
      health: this.playerStats.health, maxHealth: this.playerStats.maxHealth, alive: this.playerStats.alive,
      positionX: this.p.x, positionY: this.p.y, positionZ: this.p.z,
      walkSpeed: this.playerStats.walkSpeed ?? this.rules.walkSpeed,
      jumpPower: this.playerStats.jumpPower ?? this.rules.jumpPower
    };
    return Object.hasOwn(values, property) ? values[property] : null;
  }

  setPlayerProperty(player, property, value) {
    if (property === 'position') return this.setPlayerPosition(player, value);
    if (this._isLocal(player)) {
      if (!writeStat(this.playerStats, property, value)) return false;
      if (!this.playerStats.alive) this._onLocalDeath();
      return true;
    }
    if (!this._isRemote(player) || !this.players.setProperty(player, property, value)) return false;
    this._sendStat(player);
    return true;
  }

  setPlayerPosition(player, position) {
    if (!Array.isArray(position) || position.length !== 3 || !position.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 100000)) return false;
    if (this._isLocal(player)) {
      this.p.set(position[0], position[1], position[2]);
      this.vel.set(0, 0, 0);
      this.grounded = false;
      return true;
    }
    if (!this._isRemote(player)) return false;
    this._sendTo(player, { t: 'g', k: 'tp', pos: position.slice() });
    return true;
  }

  damagePlayer(player, amount) {
    if (this._isLocal(player)) {
      if (!damageStat(this.playerStats, amount)) return false;
      if (!this.playerStats.alive) this._onLocalDeath();
      return true;
    }
    if (!this._isRemote(player) || !this.players.damage(player, amount)) return false;
    this._sendStat(player);
    return true;
  }

  healPlayer(player, amount) {
    if (this._isLocal(player)) return healStat(this.playerStats, amount);
    if (!this._isRemote(player) || !this.players.heal(player, amount)) return false;
    this._sendStat(player);
    return true;
  }

  /** opts.fromHost: ホストの命令で戻る(ホストへ「戻った」と知らせ返さない) */
  respawn(player = 'local', opts = {}) {
    if (this._isLocal(player)) {
      resetStat(this.playerStats);
      this.p.set(this.spawn[0], this.spawn[1], this.spawn[2]);
      this.vel.set(0, 0, 0);
      this.grounded = false;
      this.activeTriggers.clear();
      this.activeRuleTriggers.clear();
      this.scriptRuntime?.onSpawn(this._lid());
      if (this.netRole === 'client' && !opts.fromHost) this._sendToHost({ t: 'g', k: 'rs' }); // ホストはHPのリセットと spawn イベントを行う
      return true;
    }
    if (!this._isRemote(player)) return false;
    this.players.respawn(player);
    this._sendTo(player, { t: 'g', k: 'rs' });
    this.scriptRuntime?.onSpawn(player);
    return true;
  }

  // ── マルチプレイ(M2-B): ホストがスクリプトを動かし、結果をクライアントへ配る ──
  // net: { sendTo(id, msg), broadcast(msg), sendToHost(msg) }(GameView が NetSession を包んで渡す)
  setNet(role, localId, net) {
    const previousRole = this.netRole;
    this.netRole = role === 'host' || role === 'client' ? role : 'solo';
    this.localId = localId || 'local';
    this.net = net || null;
    this.players.clear();
    this._partOut.clear();
    // クライアント時に停止したスクリプトを、Authorityへ昇格したタイミングで再構築する。
    if (previousRole === 'client' && this.netRole === 'host' && this.world) this._createUnifiedRuntime();
    if (this.netRole === 'client') {
      // クライアントはスクリプトを動かさない(ホストの結果だけを受け取る)。1人プレイ中に変えたパーツはホストの状態に合わせ直される
      this.scriptRuntime?.stop?.(); this.scriptRuntime = null;
      this.activeRuleTriggers.clear();
      this.partOverrides.clear();
    }
  }

  /** ルームを出た・終了した。クライアントだったなら、1人プレイの状態に戻す */
  clearNet() {
    const was = this.netRole;
    this.netRole = 'solo'; this.localId = 'local'; this.net = null;
    this.players.clear(); this._partOut.clear();
    if (was === 'client' && this.world) {
      Object.assign(this.playerStats, newStats());
      this.completed = false;
      this._createUnifiedRuntime();
      this.respawn();
    }
  }

  _sendTo(id, msg) { if (this.netRole === 'host' && validGameMsg(msg, true)) this.net?.sendTo?.(id, msg); }
  _sendAll(msg) { if (this.netRole === 'host' && validGameMsg(msg, true)) this.net?.broadcast?.(msg); }
  _sendToHost(msg) { if (this.netRole === 'client') this.net?.sendToHost?.(msg); }
  _sendStat(id) { const m = this.players.statMessage(id); if (m) this._sendTo(id, m); }

  /** スクリプトで変えたパーツを覚え(途中参加者へ送るため)、ホストなら全員へ配る(同じ(パーツ,項目)は最新だけを10Hzでまとめて送る) */
  _queuePart(key, prop, value) {
    const v = Array.isArray(value) ? value.slice() : value;
    let o = this.partOverrides.get(key);
    if (!o) { if (this.partOverrides.size >= 300) return; o = new Map(); this.partOverrides.set(key, o); }
    o.delete(prop); o.set(prop, v); // 新しい順に並べ直す(後から来た人へ、変更を起きた順に送る)
    if (this.netRole === 'host') this._partOut.set(key + '\u0000' + prop, { key, prop, v });
  }

  _flushNet() {
    if (this.netRole !== 'host' || !this._partOut.size) return;
    const now = performance.now();
    if (now - this._netFlushAt < 100) return;
    this._netFlushAt = now;
    let n = 0;
    for (const [k, e] of this._partOut) {
      if (n++ >= 30) break; // 1回に送る数の上限。残りは次回
      this._partOut.delete(k);
      this._sendAll({ t: 'g', k: 'part', key: e.key, prop: e.prop, v: e.v });
    }
  }

  _applyPart(m) {
    const w = this.world;
    if (!w) return;
    if (m.prop === 'visible') w.setPartVisible?.(m.key, m.v);
    else if (m.prop === 'move') w.movePart?.(m.key, m.v);
    else w.setPartProperty?.(m.key, m.prop, m.v);
  }

  /** ホスト: 新しく入ったプレイヤーへ、いまの状態(パーツの変更・スコア・HP)を送る */
  _syncJoiner(id) {
    let n = 0;
    for (const [key, props] of this.partOverrides) for (const [prop, v] of props) {
      if (n++ >= 600) break;
      this._sendTo(id, { t: 'g', k: 'part', key, prop, v });
    }
    this._sendTo(id, { t: 'g', k: 'score', v: this.scriptRuntime?.getScore?.() ?? 0, d: 0 });
    this._sendStat(id);
  }

  /** ホスト: 参加者の一覧 [{id,name}](自分を含む)が変わった */
  netPlayers(list) {
    if (this.netRole !== 'host' || !Array.isArray(list)) return;
    const ids = new Set(list.map((p) => p.id));
    for (const p of list) {
      if (this._isLocal(p.id) || this.players.has(p.id)) continue;
      this.players.add(p.id, p.name);
      this._syncJoiner(p.id);
      this.scriptRuntime?.onPlayerJoin(p.id);
      this.scriptRuntime?.onSpawn(p.id);
    }
    for (const pl of this.players.list()) {
      if (ids.has(pl.id)) continue;
      for (const tid of pl.active) { const t = this.world?.ruleTriggers?.find((x) => x.id === tid); if (t) this.scriptRuntime?.onLeave(t, pl.id); }
      this.scriptRuntime?.onPlayerLeave(pl.id);
      this.players.remove(pl.id);
    }
  }

  /** ホスト: 他のプレイヤーの位置([{id,name,s}])が届いた */
  netSnapshot(list) {
    if (this.netRole !== 'host' || !Array.isArray(list)) return;
    for (const e of list) this.players.setState(e.id, e.s);
  }

  /** 検証済みのゲームメッセージ(appmsg.validGameMsg を通ったもの)を受け取った */
  netGame(fromId, m) {
    if (!m) return;
    if (this.netRole === 'host') {
      if (m.k === 'rs' && this.players.has(fromId)) { this.players.respawn(fromId); this.scriptRuntime?.onSpawn(fromId); }
      return;
    }
    if (this.netRole !== 'client') return;
    const h = this._handlers();
    switch (m.k) {
      case 'stat': {
        const s = this.playerStats;
        s.health = m.h; s.maxHealth = m.mh; s.alive = m.a === 1; s.walkSpeed = m.ws; s.jumpPower = m.jp;
        if (!s.alive) this._onLocalDeath();
        break;
      }
      case 'tp': this.setPlayerPosition('local', m.pos); break;
      case 'rs': this.respawn('local', { fromHost: true }); break;
      case 'cp': this.spawn = m.pos.slice(); break;
      case 'done': this._completeLocal(); break;
      case 'score': h.onScore?.(m.v, m.d, ''); break;
      case 'msg': h.onMessage?.(m.text); break;
      case 'part': this._applyPart(m); break;
      default: break;
    }
  }

  /** ホスト: 他のプレイヤーが触れているトリガーを、届いた位置から判定する(自分の分は _checkTriggers) */
  _checkRemoteTriggers() {
    if (this.netRole !== 'host' || !this.scriptRuntime || !this.world?.ruleTriggers?.length || !this.players.size) return;
    const triggers = this.world.ruleTriggers;
    for (const pl of this.players.list()) {
      const active = new Set();
      if (pl.pos && pl.stats.alive && !pl.completed) {
        for (const trigger of triggers) {
          if (trigger.enabled === false) continue;
          let touching = false;
          for (const y of REMOTE_SY) if (sphereIntersectsOBB([pl.pos[0], pl.pos[1] + y, pl.pos[2]], RADIUS, trigger)) { touching = true; break; }
          if (touching) { active.add(trigger.id); if (!pl.active.has(trigger.id)) this.scriptRuntime.onTouch(trigger, pl.id); }
        }
      }
      for (const id of pl.active) if (!active.has(id)) { const t = triggers.find((x) => x.id === id); if (t) this.scriptRuntime.onLeave(t, pl.id); }
      pl.active = active;
    }
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
        if (trigger.enabled === false) { if (this.activeRuleTriggers.has(trigger.id)) this.scriptRuntime.onLeave(trigger, this._lid()); continue; }
        let touching = false;
        for (const y of this.sy) if (sphereIntersectsOBB([this.p.x, this.p.y + y, this.p.z], RADIUS, trigger)) { touching = true; break; }
        if (touching) { active.add(trigger.id); if (!this.activeRuleTriggers.has(trigger.id)) this.scriptRuntime.onTouch(trigger, this._lid()); }
        else if (this.activeRuleTriggers.has(trigger.id)) this.scriptRuntime.onLeave(trigger, this._lid());
      }
      this.activeRuleTriggers = active;
    }
  }

  update(dt) {
    dt = Math.min(dt, 0.05);
    // 世界時刻: クライアントはホストの時刻、それ以外はこの端末の実時間。dtの丸めやクリア(completed)では止まらない
    this.time = this.worldTime();
    if (this.completed) {
      // クリア後も動く床は動かし続ける(ホストがクリアしても、全員の世界時刻は止まらない)
      if (this.world?.dynamics?.size) this.world.dynamics.step(this.time, null, null);
      if (this.netRole === 'host') { this._checkRemoteTriggers(); this.scriptRuntime?.update?.(dt); this._flushNet(); } // ホストがクリアしても、他のプレイヤーのゲームは続く
      return;
    }
    if (!this.playerStats.alive) {
      this.vel.set(0, 0, 0);
      this.logicRuntime?.update?.({ position: this.p, dt });
      this._checkRemoteTriggers();
      this.scriptRuntime?.update?.(dt);
      this._flushNet();
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
    this._checkRemoteTriggers();
    this.logicRuntime?.update?.({ position: this.p, dt });
    this.scriptRuntime?.update?.(dt);
    this._flushNet();
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
    this.remote.update(dt);
    const cp = Math.cos(this.pitch);
    const tx = this.p.x, ty = this.p.y + this.height * 0.75, tz = this.p.z;
    this.camera.position.set(tx + Math.sin(this.yaw) * cp * this.dist, ty + Math.sin(this.pitch) * this.dist, tz + Math.cos(this.yaw) * cp * this.dist);
    this.camera.lookAt(tx, ty, tz);
    if (this.bloom) this.bloom.render(dt); else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.scriptRuntime?.stop?.();
    this.remote.dispose();
    this.renderer.setAnimationLoop(null);
    this.ro.disconnect();
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('keyup', this._onKeyUp);
    this.renderer.domElement.removeEventListener('wheel', this._onWheel);
    if (this.holder) { this.scene.remove(this.holder); disposeObject(this.holder); }
    if (this.world) { this.scene.remove(this.world.group); disposeWorld(this.world); }
    this.bloom?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}

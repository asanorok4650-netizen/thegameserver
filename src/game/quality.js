// 描画品質・パフォーマンス設定。ゲーム内メニューから変更し、localStorage に保存する。
import { CONFIG } from '../config.js';

const KEY = 'rbxl.gfx';

// 品質プリセット。pixelRatio は描画解像度の上限(端末の devicePixelRatio と、設定画面の pixelRatioCap の小さいほうも超えない)。
// 'auto' は高品質から始め、動作が重いときだけ解像度を段階的に下げる(動的解像度)。
export const QUALITY_PRESETS = {
  auto: { label: '自動', pixelRatio: 2 },
  low: { label: '低', pixelRatio: 1 },
  medium: { label: '中', pixelRatio: 1.5 },
  high: { label: '高', pixelRatio: 2 }
};
export const QUALITY_KEYS = Object.keys(QUALITY_PRESETS);
export const FPS_LIMITS = [30, 60, 0]; // 0 = 上限なし(画面のリフレッシュレートまで)
export const DEFAULT_SETTINGS = { quality: 'auto', fpsLimit: 60, showStats: false };

function sanitize(r) {
  return {
    quality: QUALITY_KEYS.includes(r?.quality) ? r.quality : DEFAULT_SETTINGS.quality,
    fpsLimit: FPS_LIMITS.includes(r?.fpsLimit) ? r.fpsLimit : DEFAULT_SETTINGS.fpsLimit,
    showStats: r?.showStats === true
  };
}

export function loadSettings() {
  try { return sanitize(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { return sanitize({}); }
}

function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* 保存できない環境でも動かす */ }
}

const MIN_SCALE = 0.5; // 動的解像度の下限(上限は1)
const DOWN_STEP = 0.1;
const UP_STEP = 0.05;
const WINDOW_MS = 500; // 統計と動的解像度の判定に使う計測の区切り
const SETTLE_MS = 3000; // 読み込み直後は重いので、この間は解像度を動かさない
const NO_DOWN_FIRST_MS = 60000; // 解像度を下げても速くならなかったとき、次に下げるまで待つ時間(繰り返すごとに2倍、上限10分)

/** 解像度の決定・フレーム上限・動的解像度・統計(FPS/描画コール数など)をまとめて扱う */
export class GraphicsController {
  constructor(renderer, onResolutionChange) {
    this.renderer = renderer;
    this.onResolutionChange = onResolutionChange;
    this.onStats = null; // 統計表示がオンのときだけ、約0.5秒ごとに呼ばれる
    this.settings = loadSettings();
    this.scale = 1; // 'auto' のときの動的解像度(MIN_SCALE〜1)
    this.stats = null;
    this._lastRender = 0;
    this._lastFrame = 0;
    this._readyAt = Infinity;
    this._lastUpAt = 0;
    this._resetAdapt();
    this._resetWindow(0);
  }

  _resetAdapt() {
    this._upNeed = 10; // 解像度を戻すまでに必要な「良い」計測の回数(上げてすぐ落ちたら延ばす)
    this._bad = 0; this._good = 0;
    this._probe = null; // 解像度を下げた効果の確認中
    this._noDownUntil = 0; this._noDownMs = NO_DOWN_FIRST_MS;
  }

  /** ワールドとキャラクターの配置が終わった。少し待ってから動的解像度を始める */
  markReady(now = performance.now()) { this._readyAt = now + SETTLE_MS; this._resetWindow(0); this._bad = 0; this._good = 0; }

  /** 設定の一部を変えて保存する。変更後の設定を返す */
  set(patch) {
    const prev = this.settings;
    this.settings = sanitize({ ...prev, ...patch });
    saveSettings(this.settings);
    if (this.settings.quality !== prev.quality) {
      this.scale = 1; this._resetAdapt(); this._resetWindow(0);
      this.onResolutionChange?.();
    }
    if (this.settings.fpsLimit !== prev.fpsLimit) { this._resetAdapt(); this._resetWindow(0); }
    return this.settings;
  }

  /** 今使う描画解像度(devicePixelRatio 換算) */
  get pixelRatio() {
    const preset = QUALITY_PRESETS[this.settings.quality];
    const cap = Math.min(window.devicePixelRatio || 1, CONFIG.pixelRatioCap, preset.pixelRatio);
    const scale = this.settings.quality === 'auto' ? this.scale : 1;
    return Math.max(0.5, +(cap * scale).toFixed(2));
  }

  /** フレーム上限。false なら、このフレームは描画も更新も飛ばす(時間は溜まるので動きは遅れない) */
  shouldRender(now) {
    const limit = this.settings.fpsLimit;
    if (!limit) return true;
    if (now - this._lastRender < 1000 / limit - 1) return false; // 1msの余裕: 60Hz画面でも間引きすぎない
    this._lastRender = now;
    return true;
  }

  /** 1フレーム描画した直後に呼ぶ。cpuMs はそのフレームの更新+描画命令にかかった時間 */
  endFrame(now, cpuMs = 0) {
    if (this._lastFrame) { this._winMs += Math.min(now - this._lastFrame, 100); this._winFrames++; this._winCpu += cpuMs; }
    this._lastFrame = now;
    if (!this._winStart) { this._winStart = now; return; }
    const elapsed = now - this._winStart;
    if (elapsed < WINDOW_MS) return;
    if (elapsed > 2000 || !this._winFrames) { this._resetWindow(now); return; } // 裏画面などで止まっていた区間は捨てる
    const avg = this._winMs / this._winFrames;
    const info = this.renderer.info, el = this.renderer.domElement;
    this.stats = {
      fps: Math.round((this._winFrames * 1000) / this._winMs),
      ms: avg,
      cpu: this._winCpu / this._winFrames,
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      ratio: this.renderer.getPixelRatio(),
      width: el.width,
      height: el.height
    };
    if (this.settings.showStats) this.onStats?.(this.stats);
    if (this.settings.quality === 'auto' && now >= this._readyAt) this._adapt(avg, now);
    this._resetWindow(now);
  }

  _resetWindow(now) { this._winStart = now; this._winMs = 0; this._winFrames = 0; this._winCpu = 0; }

  _adapt(avg, now) {
    const p = this._probe;
    if (p) { // 解像度を下げた直後: 本当に速くなったかを確かめる(最初の2回は切り替えの影響があるので見ない)
      if (--p.skip >= 0) return;
      p.sum += avg; p.n++;
      if (p.n < 2) return;
      this._probe = null;
      if (p.sum / p.n > p.before * 0.9) {
        // 速くならなかった: 原因は解像度ではない(OSの30FPS制限・CPU負荷など)。元に戻して、しばらく下げない
        this.scale = p.prev;
        this._noDownUntil = now + this._noDownMs;
        this._noDownMs = Math.min(600000, this._noDownMs * 2);
        this.onResolutionChange?.();
      }
      return;
    }
    const target = 1000 / (this.settings.fpsLimit || 60);
    if (avg > target * 1.15) { // 目標より遅い状態が1秒(2回)続いたら、解像度を下げる
      this._good = 0;
      if (now < this._noDownUntil) return;
      if (++this._bad >= 2 && this.scale > MIN_SCALE) {
        if (now - this._lastUpAt < 10000) this._upNeed = Math.min(120, this._upNeed * 2); // 上げてすぐ落ちた: 次に上げるまでを延ばす
        const prev = this.scale;
        this.scale = Math.max(MIN_SCALE, +(prev - DOWN_STEP).toFixed(2));
        this._bad = 0;
        this._probe = { prev, before: avg, skip: 2, sum: 0, n: 0 };
        this.onResolutionChange?.();
      }
      return;
    }
    this._bad = 0;
    if (avg <= target * 1.08 && this.scale < 1) { // 余裕が続いたら、少しずつ戻す
      if (++this._good >= this._upNeed) {
        this.scale = Math.min(1, +(this.scale + UP_STEP).toFixed(2));
        this._good = 0; this._lastUpAt = now;
        this.onResolutionChange?.();
      }
    } else this._good = 0;
  }
}

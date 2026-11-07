// Game に描画品質(解像度・フレーム上限・動的解像度・統計)と、メニュー表示中の入力ロックを足したもの。
// engine.js 本体は変えず、描画まわりだけをここで上書きする。
import { Game } from './engine.js';
import { GraphicsController } from './quality.js';

export class GraphicsGame extends Game {
  constructor(host) {
    super(host); // 中で resize() が呼ばれる(この時点では this.gfx は未作成)
    this.gfx = new GraphicsController(this.renderer, () => this.resize());
    this.inputLocked = false;
    this.resize(); // 保存済みの品質設定で解像度を決め直す
  }

  resize() {
    if (!this.gfx) { super.resize(); return; }
    // 基底の resize と同じ処理。違いは、描画解像度を GraphicsController から取る点だけ
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.renderer.setPixelRatio(this.gfx.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  tick() {
    const g = this.gfx;
    if (!g) { super.tick(); return; }
    if (!g.shouldRender(performance.now())) return; // フレーム上限: 間引いたフレームの時間は次のdtに含まれる
    super.tick();
    g.endFrame(performance.now());
  }

  setAvatar(built) {
    super.setAvatar(built);
    this.gfx.markReady(); // 読み込みが終わってから動的解像度を始める
  }

  /** メニューを開いている間は、キー入力で動かないようにする(キーを離す操作は通す) */
  _key(e, down) {
    if (this.inputLocked && down) return;
    super._key(e, down);
  }

  setInputLocked(locked) {
    this.inputLocked = !!locked;
    if (this.inputLocked) { this.keys.clear(); this.joy.x = 0; this.joy.y = 0; this.jumpHeld = false; }
  }

  dispose() {
    if (this.gfx) this.gfx.onStats = null;
    super.dispose();
  }
}

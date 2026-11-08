// 標準のAnimateスクリプト相当: 移動の状態(待機・歩行・ジャンプ・落下)でアニメーションを切り替え、フェードでつなぐ。THREE非依存。
import { clipTime, samplePoses, blendPoses } from '../rbx/animation.js';

const MAX_ACTIONS = 8;

/**
 * update(dt, speed, grounded) → ポーズ集合 | null(今の状態のアニメーションが未読み込みのとき)
 * 歩行・ランの再生速度は speed / walkScale(Robloxの標準と同じ考え方)。
 * playAction: 歩行などの上に重ねて再生する(Robloxの Action 優先度相当)。動かす関節だけを上書きし、フェードで出入りする。
 */
export function createAnimate({ fade = 0.15, walkScale = 16, jumpTime = 0.31, moveThreshold = 0.5, runSpeed = 16.5 } = {}) {
  const clips = {};
  const t = {};
  let state = null, prev = null, fadeP = 1, airTime = 0, wasGrounded = true;
  const actions = []; // { name, anim, t, speed, loop, w, stopping }
  const rate = (s, speed) => (s === 'walk' || s === 'run' ? Math.max(speed / walkScale, 0.1) : 1);
  return {
    setClip(name, anim) { clips[name] = anim; },
    hasClip: (name) => !!clips[name],
    get state() { return state; },
    update(dt, speed, grounded) {
      let want;
      if (!grounded) {
        if (wasGrounded) airTime = 0;
        airTime += dt;
        want = airTime < jumpTime ? 'jump' : 'fall';
      } else {
        airTime = 0;
        want = speed > moveThreshold ? (speed >= runSpeed && clips.run ? 'run' : 'walk') : 'idle'; // 標準のAnimateと同じく、通常速度(16)までは歩行、それより速いときだけラン(ラン用のアニメがあるときのみ)
      }
      wasGrounded = grounded;
      if (want !== state) { prev = state; state = want; t[state] = 0; fadeP = prev ? 0 : 1; }
      t[state] += dt * rate(state, speed);
      if (prev && prev !== state) t[prev] = (t[prev] || 0) + dt * rate(prev, speed);
      const cur = clips[state];
      let base = null;
      if (cur) {
        base = samplePoses(cur, clipTime(cur, t[state]));
        if (fadeP < 1 && prev && clips[prev]) {
          fadeP = Math.min(1, fadeP + dt / fade);
          base = blendPoses(samplePoses(clips[prev], clipTime(clips[prev], t[prev])), base, fadeP);
        }
      }
      if (!actions.length) return base;
      const out = { ...(base || {}) };
      for (let i = actions.length - 1; i >= 0; i--) { // 古いものから順に重ねるため、後ろから消しても順序は保たれる
        const a = actions[i];
        a.t += dt * a.speed;
        if (!a.loop && !a.stopping && a.t >= a.anim.length) a.stopping = true;
        a.w = a.stopping ? a.w - dt / fade : Math.min(1, a.w + dt / fade);
        if (a.w <= 0) actions.splice(i, 1);
      }
      for (const a of actions) {
        const pose = samplePoses(a.anim, clipTime(a.anim, a.t));
        const under = {};
        for (const j of Object.keys(pose)) if (out[j]) under[j] = out[j];
        Object.assign(out, blendPoses(under, pose, Math.max(0, Math.min(1, a.w))));
      }
      return out;
    },
    /** 重ねて再生する。同じ名前が再生中なら最初から。opts: { speed, loop(true/false/undefined=アニメの設定) } */
    playAction(name, anim, opts = {}) {
      const i = actions.findIndex((a) => a.name === name);
      if (i >= 0) actions.splice(i, 1);
      if (actions.length >= MAX_ACTIONS) actions.shift();
      actions.push({ name, anim, t: 0, speed: Math.max(0.05, Math.min(10, Number(opts.speed) || 1)), loop: opts.loop === undefined ? !!anim.loop : !!opts.loop, w: 0, stopping: false });
      return true;
    },
    /** name が空ならすべて止める(フェードアウトしてから消える) */
    stopAction(name = '') {
      let n = 0;
      for (const a of actions) if (!name || a.name === name) { a.stopping = true; n++; }
      return n;
    },
    actionNames: () => actions.filter((a) => !a.stopping).map((a) => a.name),
  };
}

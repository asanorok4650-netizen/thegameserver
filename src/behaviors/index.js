// パーツの振る舞い部品(behaviors)。コードではなく attrs の値だけで指定する(.tgwにコードは入れない)。
//   attrs.behavior = 'spinner' | 'mover' | 'bounce' | 'conveyor'   + 各部品のパラメータ(同じ attrs の別キー)
// THREE非依存。姿勢の計算(poseAt)は時刻 t の関数なので、マルチプレイでも全員が同じ動きを再現できる。

const num = (label, def, min, max, step = 1) => ({ type: 'number', label, default: def, min, max, step });

export const BEHAVIORS = Object.freeze({
  spinner: {
    id: 'spinner', label: '回転', kind: 'motion',
    description: '一定の速さで回り続けます。Y軸で回る床の上に乗ると一緒に回ります。',
    params: { axis: { type: 'select', label: '回る軸', options: ['x', 'y', 'z'], default: 'y' }, speed: num('回転速度(度/秒)', 90, -720, 720, 5) }
  },
  mover: {
    id: 'mover', label: '往復移動', kind: 'motion',
    description: '現在の位置から (dx,dy,dz) まで、なめらかに往復します。乗っているプレイヤーも運びます。',
    params: { dx: num('X方向の距離', 0, -1000, 1000), dy: num('Y方向の距離', 10, -1000, 1000), dz: num('Z方向の距離', 0, -1000, 1000), period: num('往復の周期(秒)', 4, 0.5, 120, 0.5) }
  },
  bounce: {
    id: 'bounce', label: 'バウンス', kind: 'effect',
    description: '上に乗ると、真上に跳ね上げます。',
    params: { power: num('跳ね上がる勢い(studs/秒)', 100, 10, 400, 5) }
  },
  conveyor: {
    id: 'conveyor', label: 'ベルトコンベア', kind: 'effect',
    description: '上に乗ると、パーツのX方向(赤い矢印の向き)に運ばれます。負の値で逆向き。',
    params: { speed: num('運ぶ速さ(studs/秒)', 16, -100, 100, 1) }
  }
});

export const BEHAVIOR_LIST = Object.freeze(Object.values(BEHAVIORS));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** attrs → { id, params } | null。未知のid・不正な値は無視(既定値)。attrs にこの部品以外のキーがあっても触らない */
export function resolveBehavior(attrs) {
  if (!isObj(attrs) || typeof attrs.behavior !== 'string') return null;
  const def = BEHAVIORS[attrs.behavior];
  if (!def) return null;
  const params = {};
  for (const [k, f] of Object.entries(def.params)) {
    const v = attrs[k];
    if (f.type === 'select') params[k] = f.options.includes(v) ? v : f.default;
    else params[k] = typeof v === 'number' && Number.isFinite(v) ? Math.min(f.max, Math.max(f.min, v)) : f.default;
  }
  return { id: def.id, params };
}

/** attrs の振る舞いを切り替える。前の部品のパラメータだけ消し、それ以外の attrs は残す。id が空/未知なら振る舞いなしにする */
export function setBehavior(attrs, id) {
  const out = { ...(isObj(attrs) ? attrs : {}) };
  const prev = BEHAVIORS[out.behavior];
  if (prev) for (const k of Object.keys(prev.params)) delete out[k];
  delete out.behavior;
  const def = BEHAVIORS[id];
  if (!def) return out;
  out.behavior = id;
  for (const [k, f] of Object.entries(def.params)) out[k] = f.default;
  return out;
}

// ---- 3x3行列(行優先9要素) ----
function mul(a, b) {
  const o = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return o;
}
export function axisRot(axis, rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  return axis === 'x' ? [1, 0, 0, 0, c, -s, 0, s, c] : axis === 'z' ? [c, -s, 0, s, c, 0, 0, 0, 1] : [c, 0, s, 0, 1, 0, -s, 0, c];
}

/**
 * 時刻 t(秒)での姿勢。motion系だけが動く(effect系・resolve結果がnullの部品は base のまま)。
 * @param base { pos:[x,y,z], rot:[9] }
 * @returns { pos, rot }  base を書き換えない
 */
export function poseAt(base, behavior, t) {
  if (!behavior) return { pos: base.pos.slice(), rot: base.rot.slice() };
  const p = behavior.params;
  if (behavior.id === 'spinner') {
    return { pos: base.pos.slice(), rot: mul(axisRot(p.axis, (p.speed * t * Math.PI) / 180), base.rot) };
  }
  if (behavior.id === 'mover') {
    const s = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / p.period); // 0→1→0 をなめらかに往復
    return { pos: [base.pos[0] + p.dx * s, base.pos[1] + p.dy * s, base.pos[2] + p.dz * s], rot: base.rot.slice() };
  }
  return { pos: base.pos.slice(), rot: base.rot.slice() };
}

export const isMotion = (b) => !!b && BEHAVIORS[b.id].kind === 'motion';

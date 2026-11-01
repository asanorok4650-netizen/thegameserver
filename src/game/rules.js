// ワールド設定(コードではなく数値だけ): 物理ルールと環境。THREE非依存で、エンジン・Studio・テストが共有する。
//   manifest.rules       … 物理(歩く速さ・ジャンプ力・重力)
//   world.json の environment … 空・光・霧
// どちらも「無ければ既定値」「範囲外は範囲に丸める」「型が違えば既定値」。壊れた値で落ちない。

/** @type {Record<string, { label: string, unit: string, default: number, min: number, max: number, step: number }>} */
export const RULE_FIELDS = Object.freeze({
  walkSpeed: { label: '歩く速さ', unit: 'studs/秒', default: 16, min: 0, max: 100, step: 1 },
  jumpPower: { label: 'ジャンプ力', unit: 'studs/秒', default: 50, min: 0, max: 200, step: 1 },
  gravity: { label: '重力', unit: 'studs/秒²', default: 196.2, min: 0, max: 600, step: 1 }
});

export const ENV_FIELDS = Object.freeze({
  skyColor: { label: '空の色', type: 'color', default: '#9ec9ff' },
  ambient: { label: '環境光の強さ', type: 'number', default: 1.5, min: 0, max: 4, step: 0.1 },
  sun: { label: '太陽光の強さ', type: 'number', default: 1.6, min: 0, max: 4, step: 0.1 },
  fogColor: { label: '霧の色', type: 'color', default: '#cfd8e8' },
  fogNear: { label: '霧が始まる距離', type: 'number', default: 80, min: 0, max: 5000, step: 10 },
  fogFar: { label: '霧で見えなくなる距離(0=霧なし)', type: 'number', default: 0, min: 0, max: 5000, step: 10 }
});

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clamp = (v, f) => Math.min(f.max, Math.max(f.min, v));

export function defaultRules() {
  return Object.fromEntries(Object.entries(RULE_FIELDS).map(([k, f]) => [k, f.default]));
}

/** manifest.rules → 検証済みの { walkSpeed, jumpPower, gravity } */
export function resolveRules(raw) {
  const src = isObj(raw) ? raw : {};
  const out = {};
  for (const [k, f] of Object.entries(RULE_FIELDS)) {
    const v = src[k];
    out[k] = typeof v === 'number' && Number.isFinite(v) ? clamp(v, f) : f.default;
  }
  return out;
}

export function defaultEnvironment() {
  return Object.fromEntries(Object.entries(ENV_FIELDS).map(([k, f]) => [k, f.default]));
}

/** world.json の environment → 検証済みの値 */
export function resolveEnvironment(raw) {
  const src = isObj(raw) ? raw : {};
  const out = {};
  for (const [k, f] of Object.entries(ENV_FIELDS)) {
    const v = src[k];
    if (f.type === 'color') out[k] = typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : f.default;
    else out[k] = typeof v === 'number' && Number.isFinite(v) ? clamp(v, f) : f.default;
  }
  if (out.fogFar > 0 && out.fogNear >= out.fogFar) out.fogNear = Math.max(0, out.fogFar * 0.5); // near < far を保つ
  return out;
}

/** 既定値と同じ項目を省き、変えた項目だけ残す(.tgwを小さく・読みやすく保つ)。空なら null */
export function diffFromDefault(resolved, fields) {
  const out = {};
  for (const [k, f] of Object.entries(fields)) if (resolved[k] !== f.default) out[k] = resolved[k];
  return Object.keys(out).length ? out : null;
}

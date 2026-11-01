// undo/redo。ドキュメントは不変なので、過去の doc への参照を積むだけ。
// coalesceKey が同じ連続操作(スライダー・矢印キーの連打など)は1つの履歴にまとめる。
export function createHistory(initial, { limit = 100, coalesceMs = 600 } = {}) {
  return { present: initial, past: [], future: [], limit, coalesceMs, lastKey: null, lastAt: 0, saved: initial };
}

/** 新しい doc を適用する。変化がなければ何もしない */
export function commit(h, next, { key = null, now = Date.now() } = {}) {
  if (next === h.present) return h;
  const merge = key !== null && key === h.lastKey && now - h.lastAt < h.coalesceMs && h.past.length > 0;
  const past = merge ? h.past : [...h.past, h.present].slice(-h.limit);
  return { ...h, present: next, past, future: [], lastKey: key, lastAt: now };
}

export function undo(h) {
  if (!h.past.length) return h;
  const prev = h.past[h.past.length - 1];
  return { ...h, present: prev, past: h.past.slice(0, -1), future: [h.present, ...h.future], lastKey: null };
}

export function redo(h) {
  if (!h.future.length) return h;
  const [next, ...rest] = h.future;
  return { ...h, present: next, past: [...h.past, h.present], future: rest, lastKey: null };
}

export const canUndo = (h) => h.past.length > 0;
export const canRedo = (h) => h.future.length > 0;

/** 「保存済み(書き出し/公開/ローカル保存した時点)」を印す。dirty の判定に使う */
export const markSaved = (h) => ({ ...h, saved: h.present });
export const isDirty = (h) => h.present !== h.saved;

/** 履歴ごと置き換える(ファイルを開いた時など) */
export const reset = (h, doc) => createHistory(doc, { limit: h.limit, coalesceMs: h.coalesceMs });

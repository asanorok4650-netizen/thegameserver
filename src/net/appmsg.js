// ゲーム内容のメッセージ(制御チャネル ctl の {t:'g', k:...})の仕様と検証。THREE・ブラウザ非依存。
// ホスト → クライアント: stat(HP・生存・速度) / tp(移動) / rs(リスポーン) / cp(チェックポイント) / done(クリア)
//                         / score(全体スコア) / msg(メッセージ) / part(パーツの変更)
// クライアント → ホスト: rs(自分がリスポーンした。HPのリセットとspawnイベントのため)
// どのメッセージも、受け取った側が必ず validGameMsg を通す。通らないものは捨てる。
export const MAX_TEXT = 500;
export const MAX_KEY = 100;
export const PART_PROPS = ['visible', 'move', 'color', 'size', 'position', 'rotation', 'transparency', 'collide'];

const finite = (v, lim) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
const vec3 = (v) => Array.isArray(v) && v.length === 3 && v.every((x) => finite(x, 100000));
const speedOrNull = (v) => v === null || (finite(v, 200) && v >= 0);

function validPartValue(prop, v) {
  switch (prop) {
    case 'visible': case 'collide': return typeof v === 'boolean';
    case 'move': case 'size': case 'position': case 'rotation': return vec3(v);
    case 'color': return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
    case 'transparency': return finite(v, 1) && v >= 0;
    default: return false;
  }
}

/** 正しければ整えたメッセージを、不正なら null を返す。fromHost: ホストから届いたものか */
export function validGameMsg(m, fromHost) {
  if (!m || typeof m !== 'object' || m.t !== 'g' || typeof m.k !== 'string') return null;
  if (!fromHost) return m.k === 'rs' ? { t: 'g', k: 'rs' } : null; // クライアントが送れるのは rs だけ
  switch (m.k) {
    case 'stat':
      if (!finite(m.h, 1e6) || m.h < 0 || !finite(m.mh, 1e6) || m.mh <= 0 || !(m.a === 0 || m.a === 1) || !speedOrNull(m.ws) || !speedOrNull(m.jp)) return null;
      return { t: 'g', k: 'stat', h: m.h, mh: m.mh, a: m.a, ws: m.ws, jp: m.jp };
    case 'tp': case 'cp':
      return vec3(m.pos) ? { t: 'g', k: m.k, pos: m.pos.slice() } : null;
    case 'rs': case 'done':
      return { t: 'g', k: m.k };
    case 'score':
      return finite(m.v, 1e9) && finite(m.d, 1e9) ? { t: 'g', k: 'score', v: m.v, d: m.d } : null;
    case 'msg':
      return typeof m.text === 'string' ? { t: 'g', k: 'msg', text: m.text.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, MAX_TEXT) } : null;
    case 'part':
      if (typeof m.key !== 'string' || !m.key || m.key.length > MAX_KEY || !PART_PROPS.includes(m.prop) || !validPartValue(m.prop, m.v)) return null;
      return { t: 'g', k: 'part', key: m.key, prop: m.prop, v: Array.isArray(m.v) ? m.v.slice() : m.v };
    default: return null;
  }
}

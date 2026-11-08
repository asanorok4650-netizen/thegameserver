// アニメーションアセットの取得と、標準アニメーションの割り当て。
// IDはRobloxの標準R15 Animateスクリプトのもの(手元の記憶なので、読み込めない/違うときはここを直す)。状態ごとに先頭から順に試す。
import { fetchAssetBytes } from './api.js';
import { parseAnimation } from '../rbx/animation.js';

export const DEFAULT_R15_ANIMS = {
  idle: [507766388, 507766666],
  walk: [507777826],
  jump: [507765000],
  fall: [507767968],
};

const cache = new Map();
/** アニメーションアセットを取得して解析する(同じIDは使い回す) */
export function loadAnimation(id) {
  if (!cache.has(id)) {
    const p = fetchAssetBytes(id).then((buf) => parseAnimation(buf));
    cache.set(id, p);
    p.catch(() => cache.delete(id));
  }
  return cache.get(id);
}

/** 状態ごとに読み込めたものを ctl.setClip する。結果は log に出す */
export async function loadDefaultAnimations(ctl, ids = DEFAULT_R15_ANIMS, log = (...a) => console.info('[anim]', ...a)) {
  await Promise.all(Object.entries(ids).map(async ([state, list]) => {
    for (const id of list) {
      try {
        const a = await loadAnimation(id);
        ctl.setClip(state, a);
        log(`${state}: ${id} 読み込み OK (${a.keyframeCount}キーフレーム / ${a.poseCount}ポーズ / ${a.length.toFixed(2)}秒${a.loop ? ' / ループ' : ''})`);
        return;
      } catch (e) { log(`${state}: ${id} 失敗 - ${e.message}`); }
    }
    log(`${state}: 読み込めないため手続き式で代用`);
  }));
}

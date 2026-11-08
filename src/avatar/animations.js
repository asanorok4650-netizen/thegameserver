// アニメーションアセットの取得と、状態ごとの割り当て。
// 1) アバターが装備しているアニメーションパック(歩行・ラン・ジャンプ…)を優先し、2) 無い/読めない状態は標準のR15アニメで代用する。
// 標準のIDはRobloxの標準R15 Animateスクリプトのもの(手元の記憶なので、読み込めない/違うときはここを直す)。状態ごとに先頭から順に試す。
import { fetchAssetBytes } from './api.js';
import { parseAnimation, parseKeyframeSequence } from '../rbx/animation.js';
import { parseCurveAnimation } from '../rbx/curve-animation.js';
import { parseModel } from '../rbx/model.js';
import { animationSlotsFromReport, animationIdsFromTree } from '../rbx/anim-pack.js';

export const DEFAULT_R15_ANIMS = {
  idle: [507766388, 507766666],
  walk: [507777826],
  jump: [507765000],
  fall: [507767968],
};
export const ANIM_STATES = ['idle', 'walk', 'run', 'jump', 'fall'];

const cache = new Map();
/** アニメーションアセット(KeyframeSequence / CurveAnimation)を取得して解析する(同じIDは使い回す) */
export function loadAnimation(id) {
  if (!cache.has(id)) {
    const p = fetchAssetBytes(id).then((buf) => parseAnimation(buf));
    cache.set(id, p);
    p.catch(() => cache.delete(id));
  }
  return cache.get(id);
}

const packCache = new Map();
/** アニメーションパックのアセットから、実際のアニメーションを読む。{ anim, via } を返す */
export function loadPackAnimation(packId) {
  if (!packCache.has(packId)) {
    const p = (async () => {
      const tree = parseModel(await fetchAssetBytes(packId));
      const direct = parseKeyframeSequence(tree) || parseCurveAnimation(tree); // パック自体がアニメーションの場合
      if (direct) return { anim: direct, via: '直接' };
      const ids = animationIdsFromTree(tree);
      if (!ids.length) throw new Error('パックの中に Animation が見つかりません');
      let last;
      for (const id of ids) {
        try { return { anim: await loadAnimation(id), via: id }; } catch (e) { last = e; }
      }
      throw last;
    })();
    packCache.set(packId, p);
    p.catch(() => packCache.delete(packId));
  }
  return packCache.get(packId);
}

const describe = (a) => `${a.keyframeCount}キーフレーム / ${a.poseCount}ポーズ / ${a.length.toFixed(2)}秒${a.loop ? ' / ループ' : ''}${a.kind === 'curve' ? ' / カーブ形式' : ''}`;

/**
 * 状態ごとに、アバターのアニメーションパック → 標準アニメ の順で読み込み、ctl.setClip する。結果は log に出す。
 * @param report buildDescriptor の report(アバターが持つアセットの一覧)
 */
export async function loadAvatarAnimations(ctl, report, ids = DEFAULT_R15_ANIMS, log = (...a) => console.info('[anim]', ...a)) {
  const packs = animationSlotsFromReport(report);
  await Promise.all(ANIM_STATES.map(async (state) => {
    if (packs[state]) {
      try {
        const { anim, via } = await loadPackAnimation(packs[state]);
        ctl.setClip(state, anim);
        log(`${state}: アバターのアニメ ${packs[state]}(${via}) 読み込み OK (${describe(anim)})`);
        return;
      } catch (e) { log(`${state}: アバターのアニメ ${packs[state]} 失敗 - ${e.message}`); }
    }
    for (const id of ids[state] || []) {
      try {
        const a = await loadAnimation(id);
        ctl.setClip(state, a);
        log(`${state}: 標準 ${id} 読み込み OK (${describe(a)})`);
        return;
      } catch (e) { log(`${state}: 標準 ${id} 失敗 - ${e.message}`); }
    }
    if (ids[state] || packs[state]) log(`${state}: 読み込めないため手続き式で代用`);
  }));
}

/** 標準アニメだけを読む(アバターのパックを使わない) */
export function loadDefaultAnimations(ctl, ids = DEFAULT_R15_ANIMS, log) {
  return loadAvatarAnimations(ctl, [], ids, log);
}

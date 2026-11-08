// アバターが装備しているアニメーションパック(歩行・ラン・ジャンプなど)の解釈。THREE非依存。
// アバターAPIの assets には、IdleAnimation / WalkAnimation / RunAnimation / JumpAnimation / FallAnimation ... のアセットが入っている。
// そのアセットの中身は、Animation インスタンス(AnimationId = 実際のKeyframeSequenceのアセットID)を持つモデル。

const SLOT_BY_TYPE = {
  idleanimation: 'idle', walkanimation: 'walk', runanimation: 'run', jumpanimation: 'jump',
  fallanimation: 'fall', climbanimation: 'climb', swimanimation: 'swim',
};
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

/** buildDescriptor の report([{ id, type }])から、状態ごとのアニメーションパックのアセットIDを取り出す */
export function animationSlotsFromReport(report) {
  const out = {};
  for (const e of report || []) {
    const slot = SLOT_BY_TYPE[norm(e.type)];
    if (slot && !out[slot]) out[slot] = e.id;
  }
  return out;
}

/** 'rbxassetid://123' / 'http://www.roblox.com/asset/?id=123' / '123' → 123。取れなければ null */
export function animationIdFromUri(uri) {
  if (typeof uri !== 'string') return null;
  const m = uri.match(/[?&]id=(\d+)/) || uri.match(/(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}

/** パック(parseModelの結果)の中の Animation の AnimationId を、Animation1 を先頭にした順で返す */
export function animationIdsFromTree(tree) {
  const list = [...tree.instances.values()]
    .filter((i) => i.className === 'Animation')
    .map((i) => ({ name: i.props.Name || '', id: animationIdFromUri(i.props.AnimationId) }))
    .filter((a) => a.id);
  list.sort((a, b) => (a.name === 'Animation1' ? 0 : 1) - (b.name === 'Animation1' ? 0 : 1));
  return list.map((a) => a.id);
}

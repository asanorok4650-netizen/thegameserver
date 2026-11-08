// いま開いているワールドのアニメーション一覧(名前 → アニメ)。THREE非依存。
// スクリプトのブロック(アニメーションを再生する)は、ここに登録された名前で呼ぶ。
// clips は読み込み済み、refs はアセットID(最初に使うときに取得する)。
let reg = { clips: new Map(), refs: new Map() };
let loader = null;

/** ワールドを読み込むたびに入れ替える。info: { clips:[{name, anim}], refs:[{name, id}] } */
export function setPlaceAnimations(info) {
  reg = { clips: new Map(), refs: new Map() };
  for (const c of info?.clips || []) reg.clips.set(c.name, c.anim);
  for (const r of info?.refs || []) if (!reg.clips.has(r.name)) reg.refs.set(r.name, r.id);
}
export const placeAnimationNames = () => [...reg.clips.keys(), ...reg.refs.keys()];
export const hasPlaceAnimation = (name) => reg.clips.has(name) || reg.refs.has(name);

/** 名前からアニメを得る。refs は取得して使い回す。無ければ null、取得に失敗したら例外 */
export async function getPlaceAnimation(name) {
  if (reg.clips.has(name)) return reg.clips.get(name);
  if (!reg.refs.has(name)) return null;
  loader = loader || import('../avatar/animations.js');
  const anim = await (await loader).loadAnimation(reg.refs.get(name));
  reg.clips.set(name, anim);
  reg.refs.delete(name);
  return anim;
}

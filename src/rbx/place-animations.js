// rbxl(プレイスファイル)に入っているアニメーションを取り出す。THREE非依存。
//  - KeyframeSequence / CurveAnimation: 中身をその場で解析して clips に入れる(通信なしで再生できる)
//  - Animation(AnimationId を持つもの): アセットIDだけ refs に控える(再生時に取得する)
// 取り出した結果は .tgw の manifest.scripting.animations に保存でき、スクリプトのブロックから名前で呼べる。
import { parseKeyframeSequence } from './animation.js';
import { parseCurveAnimation } from './curve-animation.js';
import { animationIdFromUri } from './anim-pack.js';

export const ANIM_LIMITS = { maxClips: 64, maxRefs: 256, maxKeysPerClip: 20000, maxTotalKeys: 100000, maxName: 100 };
const STYLES = new Set(['Linear', 'Constant', 'Elastic', 'Cubic', 'Bounce', 'CubicV2']);
const DIRS = new Set(['In', 'Out', 'InOut']);
const ORDERS = new Set(['XYZ', 'XZY', 'YZX', 'YXZ', 'ZXY', 'ZYX']);
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const vec = (a, n) => Array.isArray(a) && a.length === n && a.every(num);

// ---- 保存データの検証(.tgw は外から来るので、形を確かめて作り直す) ----
function cleanTracks(raw, limits) {
  if (!raw || typeof raw !== 'object') return null;
  const tracks = {};
  let keys = 0;
  for (const [name, arr] of Object.entries(raw)) {
    if (!Array.isArray(arr) || !arr.length) continue;
    const out = [];
    for (const k of arr) {
      if (!k || !num(k.t) || !vec(k.pos, 3) || !vec(k.q, 4)) return null;
      out.push({ t: k.t, pos: k.pos.slice(), q: k.q.slice(), style: STYLES.has(k.style) ? k.style : 'Linear', dir: DIRS.has(k.dir) ? k.dir : 'In' });
    }
    keys += out.length;
    if (keys > limits.maxKeysPerClip) return null;
    tracks[name.slice(0, limits.maxName)] = out;
  }
  return Object.keys(tracks).length ? { tracks, keys } : null;
}
function cleanFloatKeys(arr, limits) {
  if (arr === null || arr === undefined) return null;
  if (!Array.isArray(arr) || !arr.length || arr.length > limits.maxKeysPerClip) return undefined;
  const out = [];
  for (const k of arr) {
    if (!k || !num(k.t) || !num(k.v)) return undefined;
    out.push({ t: k.t, v: k.v, interp: [0, 1, 2].includes(k.interp) ? k.interp : 1, left: num(k.left) ? k.left : 0, right: num(k.right) ? k.right : 0, leftSet: !!k.leftSet, rightSet: !!k.rightSet });
  }
  return out;
}
function cleanChannels(raw, limits) {
  if (!raw || typeof raw !== 'object') return null;
  const channels = {};
  let keys = 0;
  for (const [name, ch] of Object.entries(raw)) {
    if (!ch || typeof ch !== 'object') continue;
    const out = {};
    if (ch.pos !== undefined && ch.pos !== null) {
      if (!Array.isArray(ch.pos) || ch.pos.length !== 3) return null;
      const a = ch.pos.map((k) => cleanFloatKeys(k, limits));
      if (a.some((k) => k === undefined)) return null;
      if (a.some(Boolean)) { out.pos = a; keys += a.reduce((n, k) => n + (k ? k.length : 0), 0); }
    }
    if (ch.euler) {
      if (!Array.isArray(ch.euler.curves) || ch.euler.curves.length !== 3) return null;
      const a = ch.euler.curves.map((k) => cleanFloatKeys(k, limits));
      if (a.some((k) => k === undefined)) return null;
      if (a.some(Boolean)) { out.euler = { order: ORDERS.has(ch.euler.order) ? ch.euler.order : 'XYZ', curves: a }; keys += a.reduce((n, k) => n + (k ? k.length : 0), 0); }
    } else if (Array.isArray(ch.quat) && ch.quat.length) {
      if (ch.quat.length > limits.maxKeysPerClip || !ch.quat.every((k) => k && num(k.t) && vec(k.q, 4))) return null;
      out.quat = ch.quat.map((k) => ({ t: k.t, q: k.q.slice(), interp: [0, 1, 2].includes(k.interp) ? k.interp : 1 }));
      keys += out.quat.length;
    }
    if (keys > limits.maxKeysPerClip) return null;
    if (out.pos || out.euler || out.quat) channels[name.slice(0, limits.maxName)] = out;
  }
  return Object.keys(channels).length ? { channels, keys } : null;
}

/** 保存された1本のアニメーションを検証して作り直す。不正なら null */
export function cleanAnimation(a, limits = ANIM_LIMITS) {
  if (!a || typeof a !== 'object') return null;
  const base = { name: String(a.name || '').slice(0, limits.maxName), loop: !!a.loop, priority: Number.isInteger(a.priority) ? a.priority : 0, length: num(a.length) && a.length >= 0 ? a.length : 0, markers: [] };
  if (a.kind === 'curve') {
    const c = cleanChannels(a.channels, limits);
    return c ? { ...base, kind: 'curve', channels: c.channels, keyframeCount: c.keys, poseCount: Object.keys(c.channels).length, warnings: [] } : null;
  }
  const t = cleanTracks(a.tracks, limits);
  return t ? { ...base, tracks: t.tracks, keyframeCount: num(a.keyframeCount) ? a.keyframeCount : 0, poseCount: t.keys } : null;
}

/** manifest.scripting.animations を検証して { clips:[{name, anim}], refs:[{name, id}] } にする。壊れた項目は捨てる */
export function sanitizeAnimations(raw, limits = ANIM_LIMITS) {
  const out = { clips: [], refs: [] };
  if (!raw || typeof raw !== 'object') return out;
  const names = new Set();
  let total = 0;
  for (const c of Array.isArray(raw.clips) ? raw.clips.slice(0, limits.maxClips) : []) {
    const name = c && typeof c.name === 'string' ? c.name.slice(0, limits.maxName) : '';
    const anim = name && !names.has(name) ? cleanAnimation(c.anim, limits) : null;
    if (!anim || total + anim.poseCount > limits.maxTotalKeys) continue;
    total += anim.poseCount; names.add(name);
    out.clips.push({ name, anim: { ...anim, name } });
  }
  for (const r of Array.isArray(raw.refs) ? raw.refs.slice(0, limits.maxRefs) : []) {
    const name = r && typeof r.name === 'string' ? r.name.slice(0, limits.maxName) : '';
    if (!name || names.has(name) || !Number.isInteger(r.id) || r.id <= 0) continue;
    names.add(name);
    out.refs.push({ name, id: r.id });
  }
  return out;
}

/**
 * parseRbxm の結果からアニメーションを集める。名前が重なるときは「名前#2」のようにする。
 * @returns { clips:[{name, anim}], refs:[{name, id}], skipped:[string] }
 */
export function extractPlaceAnimations(tree, limits = ANIM_LIMITS) {
  const clips = [], refs = [], skipped = [], used = new Set();
  let total = 0;
  const unique = (raw, fallback) => {
    const base = String(raw || fallback).slice(0, limits.maxName - 4);
    let name = base, n = 2;
    while (used.has(name)) name = `${base}#${n++}`;
    used.add(name);
    return name;
  };
  for (const inst of tree.instances.values()) {
    const cls = inst.className;
    if (cls === 'KeyframeSequence' || cls === 'CurveAnimation') {
      if (clips.length >= limits.maxClips) { skipped.push(`${inst.props.Name || cls}: 上限(${limits.maxClips}本)を超えています`); continue; }
      const single = { instances: new Map([[0, inst]]) };
      let anim;
      try { anim = cls === 'KeyframeSequence' ? parseKeyframeSequence(single) : parseCurveAnimation(single); }
      catch (e) { skipped.push(`${inst.props.Name || cls}: ${e.message}`); continue; }
      if (!anim || !(anim.poseCount > 0)) { skipped.push(`${inst.props.Name || cls}: 中身が空です`); continue; }
      if (anim.poseCount > limits.maxKeysPerClip || total + anim.poseCount > limits.maxTotalKeys) { skipped.push(`${inst.props.Name || cls}: 大きすぎます(${anim.poseCount})`); continue; }
      total += anim.poseCount;
      const name = unique(inst.props.Name, cls);
      clips.push({ name, anim: { ...anim, name } });
    } else if (cls === 'Animation') {
      const id = animationIdFromUri(inst.props.AnimationId);
      if (!id || refs.length >= limits.maxRefs) continue;
      if (refs.some((r) => r.id === id)) continue; // 同じアセットは1つに
      refs.push({ name: unique(inst.props.Name, 'Animation'), id });
    }
  }
  return { clips, refs, skipped };
}

// 位置・サイズ・回転を、スライダー + 数値欄で動かす。ドラッグ中の変更は同じキーで履歴にまとめる(1回のundoで戻る)。
import { useEffect, useState } from 'react';
import { eulerToRot, rotToEuler, IDENT } from './model.js';

const fmt = (v) => (Math.round(v * 1000) / 1000 + 0).toString();
const AXES = ['X', 'Y', 'Z'];
const rd = (v, step) => Math.round(v / step) * step;

/**
 * 1本のスライダー + 数値欄。
 * 相対モード(span): スライダーは「今の値 ± span」の範囲で、指を離した時に今の値を中心にとり直す
 *   → 位置やサイズのように範囲が決まっていない値でも、どこまでも動かせる。
 * 絶対モード(min/max): 回転のように範囲が決まっている値。
 */
function Slide({ axis, value, step, span, min, max, floor, onChange }) {
  const [center, setCenter] = useState(value);
  const [text, setText] = useState(fmt(value));
  useEffect(() => { setText(fmt(value)); }, [value]);
  const rel = span !== undefined;
  useEffect(() => { if (rel && (value < center - span || value > center + span)) setCenter(value); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const c = rel ? rd(center, step) : 0;
  const lo = rel ? Math.max(floor === undefined ? -Infinity : floor, c - span) : min;
  const hi = rel ? c + span : max;
  const release = () => { if (rel) setCenter(value); };
  const commitText = () => {
    const n = Number(text);
    if (!Number.isFinite(n) || (floor !== undefined && n < floor) || n === value) { setText(fmt(value)); return; }
    onChange(n); if (rel) setCenter(n);
  };
  return (
    <div className="st-slide">
      <span className="st-axis">{axis}</span>
      <input className="st-range" type="range" min={lo} max={hi} step={step} value={Math.min(hi, Math.max(lo, value))} aria-label={axis}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={release} onKeyUp={release} onBlur={release} />
      <input className="text-input st-num" type="number" inputMode="decimal" step={step} value={text} aria-label={axis + ' の値'}
        onChange={(e) => setText(e.target.value)} onBlur={commitText} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
    </div>
  );
}

/** part は選択中の1つ。onPatch(ids, patch, key) は useStudio の patch。grid はスナップ幅(0=なし) */
export default function TransformFields({ part, grid, onPatch }) {
  const ids = [part.id];
  const posStep = grid > 0 ? grid : 0.1;
  const sizeStep = grid > 0 ? grid : 0.1;
  const setAt = (field, i, v) => {
    const next = part[field].slice(); next[i] = v;
    onPatch(ids, { [field]: next }, `${field}${i}-${part.id}`);
  };

  // 回転は角度3つを内部に持ち、スライダー操作中は角度から行列を作る(行列→角度の変換で値が揺れないように)
  const [eul, setEul] = useState(() => rotToEuler(part.rot));
  useEffect(() => {
    const back = eulerToRot(eul[0], eul[1], eul[2]);
    if (back.some((v, i) => Math.abs(v - part.rot[i]) > 1e-4)) setEul(rotToEuler(part.rot)); // 外から変わった時(復元・リセット等)だけ読み直す
  }, [part.rot]); // eslint-disable-line react-hooks/exhaustive-deps
  const setRot = (i, v) => {
    const e = eul.slice(); e[i] = v; setEul(e);
    onPatch(ids, { rot: eulerToRot(e[0], e[1], e[2]) }, `rot${i}-${part.id}`);
  };
  const isIdent = part.rot.every((v, i) => Math.abs(v - IDENT[i]) < 1e-6);

  return (
    <>
      <div className="st-group">
        <span className="st-label">位置(スライダーは今の値±32。離すと中心をとり直します)</span>
        {AXES.map((a, i) => <Slide key={a} axis={a} value={part.pos[i]} step={posStep} span={32} onChange={(v) => setAt('pos', i, v)} />)}
      </div>
      <div className="st-group">
        <span className="st-label">サイズ</span>
        {AXES.map((a, i) => <Slide key={a} axis={a} value={part.size[i]} step={sizeStep} span={Math.max(16, Math.ceil(part.size[i]))} floor={Math.max(0.05, grid > 0 ? grid : 0.1)} onChange={(v) => setAt('size', i, Math.max(0.05, v))} />)}
      </div>
      <div className="st-group">
        <span className="st-label">回転(度)</span>
        {AXES.map((a, i) => <Slide key={a} axis={a} value={eul[i]} step={1} min={-180} max={180} onChange={(v) => setRot(i, v)} />)}
        <div className="st-row">
          {[15, 45, 90].map((d) => (
            <button key={d} className="secondary-button" type="button" onClick={() => setRot(1, ((eul[1] + d + 180) % 360) - 180)}>Y +{d}°</button>
          ))}
          <button className="secondary-button" type="button" disabled={isIdent} onClick={() => { setEul([0, 0, 0]); onPatch(ids, { rot: IDENT.slice() }); }}>リセット</button>
        </div>
      </div>
    </>
  );
}

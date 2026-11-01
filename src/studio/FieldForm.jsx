// 数値・色・選択肢の定義(game/rules.js, behaviors/index.js のフィールド定義)からフォームを作る。
// スマホで触りやすいよう、数値はスライダー + 入力欄の組にする。範囲は定義の min/max。
const fmt = (v) => (Math.round(v * 1000) / 1000).toString();

export default function FieldForm({ fields, values: given, onChange, keyPrefix = '' }) {
  const values = given || {};
  return (
    <>
      {Object.entries(fields).map(([k, f]) => {
        const v = values[k] ?? f.default;
        if (f.type === 'color') {
          return (
            <label className="st-field" key={k}><span className="st-label">{f.label}</span>
              <input className="st-color" type="color" value={v} onChange={(e) => onChange(k, e.target.value)} /></label>
          );
        }
        if (f.type === 'select') {
          return (
            <label className="st-field" key={k}><span className="st-label">{f.label}</span>
              <select className="text-input" value={v} onChange={(e) => onChange(k, e.target.value)}>
                {f.options.map((o) => <option key={o} value={o}>{o.toUpperCase()}</option>)}
              </select></label>
          );
        }
        const step = f.step || 1;
        return (
          <div className="st-field" key={keyPrefix + k}>
            <span className="st-label">{f.label}{f.unit ? `(${f.unit})` : ''}</span>
            <div className="st-slide st-slide2">
              <input className="st-range" type="range" min={f.min} max={f.max} step={step} value={v} onChange={(e) => onChange(k, Number(e.target.value))} aria-label={f.label} />
              <input className="text-input st-num" type="number" min={f.min} max={f.max} step={step} value={fmt(v)}
                onChange={(e) => { if (e.target.value !== '') onChange(k, Number(e.target.value)); }} />
            </div>
          </div>
        );
      })}
    </>
  );
}

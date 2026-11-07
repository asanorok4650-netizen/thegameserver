import { useEffect } from 'react';
import Icon from './Icon.jsx';
import { QUALITY_KEYS, QUALITY_PRESETS, FPS_LIMITS } from '../game/quality.js';
import '../gamemenu.css';

const QUALITY_OPTIONS = QUALITY_KEYS.map((k) => ({ value: k, label: QUALITY_PRESETS[k].label }));
const FPS_OPTIONS = FPS_LIMITS.map((v) => ({ value: v, label: v ? `${v} FPS` : '制限なし' }));
const ONOFF_OPTIONS = [{ value: false, label: 'オフ' }, { value: true, label: 'オン' }];

const QUALITY_DESC = {
  auto: '動作が重いときだけ、描画の解像度を自動で下げます。',
  low: '解像度を抑えて、動作を軽くします。',
  medium: '解像度と動作の軽さのバランスです。',
  high: '最も高い解像度で描画します。'
};

function Chevron({ dir }) {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d={dir === 'left' ? 'M15 4 7 12l8 8' : 'm9 4 8 8-8 8'} />
    </svg>
  );
}

/** 「‹ 値 ›」の形で選ぶ(端まで行くと反対側へ戻る) */
function ArrowSelect({ label, options, value, onChange }) {
  const i = Math.max(0, options.findIndex((o) => o.value === value));
  const step = (d) => onChange(options[(i + d + options.length) % options.length].value);
  return (
    <div className="gm-select" role="group" aria-label={label}>
      <button type="button" className="gm-arrow" aria-label={`${label}: 前の項目`} onClick={() => step(-1)}><Chevron dir="left" /></button>
      <span className="gm-value" aria-live="polite">{options[i].label}</span>
      <button type="button" className="gm-arrow" aria-label={`${label}: 次の項目`} onClick={() => step(1)}><Chevron dir="right" /></button>
    </div>
  );
}

function Row({ label, desc, children }) {
  return (
    <div className="gm-row">
      <div className="gm-label">
        <div>{label}</div>
        {desc && <div className="gm-desc">{desc}</div>}
      </div>
      <div className="gm-control">{children}</div>
    </div>
  );
}

/** ゲーム中のメニュー(Roblox風)。いまは「設定」タブだけ */
export default function GameMenu({ settings, onChange, onResume, onRespawn, onExit, canRespawn }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onResume(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onResume]);

  return (
    <div className="gm-overlay" role="dialog" aria-modal="true" aria-labelledby="gm-title-tab">
      <div className="gm-panel">
        <div className="gm-tabs" role="tablist">
          <button type="button" id="gm-title-tab" role="tab" aria-selected="true" className="gm-tab active">
            <Icon name="settings" size={22} /><span>設定</span>
          </button>
        </div>

        <div className="gm-body">
          <h2 className="gm-section">グラフィック</h2>
          <Row label="グラフィック品質" desc={QUALITY_DESC[settings.quality]}>
            <ArrowSelect label="グラフィック品質" options={QUALITY_OPTIONS} value={settings.quality} onChange={(v) => onChange({ quality: v })} />
          </Row>
          <Row label="フレームレート上限" desc="下げると、バッテリーの消費と発熱を抑えられます。">
            <ArrowSelect label="フレームレート上限" options={FPS_OPTIONS} value={settings.fpsLimit} onChange={(v) => onChange({ fpsLimit: v })} />
          </Row>

          <h2 className="gm-section">パフォーマンス</h2>
          <Row label="統計情報の表示" desc="FPS・描画コール数・解像度などを画面に表示します。">
            <ArrowSelect label="統計情報の表示" options={ONOFF_OPTIONS} value={settings.showStats} onChange={(v) => onChange({ showStats: v })} />
          </Row>
        </div>

        <div className="gm-footer">
          <button type="button" className="gm-btn" onClick={onExit}>退出</button>
          <button type="button" className="gm-btn" onClick={onRespawn} disabled={!canRespawn}>リスポーン</button>
          <button type="button" className="gm-btn primary" onClick={onResume}>再開</button>
        </div>
      </div>
    </div>
  );
}

/** 統計情報の表示(設定でオンにしたときだけ) */
export function StatsOverlay({ stats }) {
  if (!stats) return null;
  const k = (n) => (n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n));
  return (
    <div className="gm-stats" aria-hidden="true">
      <div>{stats.fps} FPS ({stats.ms.toFixed(1)} ms)</div>
      <div>描画 {k(stats.calls)} コール / {k(stats.triangles)} 三角形</div>
      <div>形状 {k(stats.geometries)} / テクスチャ {k(stats.textures)}</div>
      <div>解像度 ×{stats.ratio} ({stats.width}×{stats.height})</div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Game } from '../game/engine.js';
import { fetchRbxl, parseRbxl } from '../game/loader.js';
import { buildWorld } from '../game/world.js';
import { buildAvatar } from '../avatar/builder.js';
import { serverFileUrl } from '../servers/api.js';

const JOY_R = 55;
const tick = () => new Promise((r) => setTimeout(r, 0)); // 画面(ログ)を更新する隙間を作る
const mb = (n) => (n / 1048576).toFixed(1) + 'MB';

export default function GameView({ server, desc, onExit }) {
  const hostRef = useRef(null);
  const gameRef = useRef(null);
  const knobRef = useRef(null);
  const baseRef = useRef(null);
  const joy = useRef({ id: null, ox: 0, oy: 0 });
  const look = useRef({ id: null, x: 0, y: 0 });
  const descRef = useRef(desc);
  const [phase, setPhase] = useState('loading'); // loading | playing | error
  const [lines, setLines] = useState([]);
  const [progress, setProgress] = useState('');
  const [showLog, setShowLog] = useState(true);

  useEffect(() => {
    let dead = false;
    const ac = new AbortController();
    const game = new Game(hostRef.current);
    gameRef.current = game;
    const log = (kind, text) => { if (!dead) setLines((l) => [...l.slice(-80), { kind, text }]); };

    (async () => {
      try {
        log('info', `「${server.name}」を取得中…`);
        const bytes = await fetchRbxl(serverFileUrl(server.id), server.size, (a, b) => { if (!dead) setProgress(`${mb(a)} / ${mb(b)}`); }, ac.signal);
        if (dead) return;
        setProgress('');
        log('ok', `ダウンロード完了(${mb(bytes.length)})`);
        await tick();

        log('info', '解析中…');
        await tick();
        const tree = parseRbxl(bytes);
        log('ok', `解析完了: インスタンス ${tree.instances.size}個`);
        for (const w of tree.warnings.slice(0, 5)) log('warn', w);
        if (tree.warnings.length > 5) log('warn', `ほか警告 ${tree.warnings.length - 5}件`);
        await tick();
        if (dead) return;

        log('info', 'ワールドを構築中…');
        await tick();
        const world = buildWorld(tree, log);
        const s = world.stats;
        log('ok', `パーツ ${s.parts}個(描画 ${s.drawn} / 衝突 ${s.collidable})`);
        if (!s.spawnFound) log('warn', 'SpawnLocationがありません。原点付近から開始します');
        for (const [k, v] of Object.entries(s.ignored)) log('warn', `${k} ${v}件は未対応のため表示されません`);
        for (const [k, v] of Object.entries(s.approx)) log('warn', `${k} ${v}個は箱の形で代用しています`);
        game.setWorld(world);

        log('info', 'キャラクターを配置中…');
        await tick();
        const built = buildAvatar(descRef.current);
        game.setAvatar(built);
        log('ok', `キャラクター(${built.rigType})を配置。歩行アニメ対象: ${game.anim.found.length}/4`);
        if (!dead) { setPhase('playing'); setTimeout(() => setShowLog(false), 4000); }
      } catch (e) {
        if (dead || e.name === 'AbortError') return;
        log('error', e.message || String(e));
        setPhase('error');
      }
    })();

    return () => { dead = true; ac.abort(); game.dispose(); gameRef.current = null; };
  }, [server.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- 左: 仮想ジョイスティック ----
  function joyDown(e) {
    if (joy.current.id !== null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = e.currentTarget.getBoundingClientRect();
    joy.current = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
    const b = baseRef.current;
    b.style.display = 'block';
    b.style.left = e.clientX - r.left + 'px';
    b.style.top = e.clientY - r.top + 'px';
    knobRef.current.style.transform = 'translate(0px,0px)';
  }
  function joyMove(e) {
    const j = joy.current;
    if (e.pointerId !== j.id) return;
    let dx = e.clientX - j.ox, dy = e.clientY - j.oy;
    const len = Math.hypot(dx, dy);
    if (len > JOY_R) { dx *= JOY_R / len; dy *= JOY_R / len; }
    knobRef.current.style.transform = `translate(${dx}px,${dy}px)`;
    if (gameRef.current) gameRef.current.setMove(dx / JOY_R, -dy / JOY_R);
  }
  function joyUp(e) {
    if (e.pointerId !== joy.current.id) return;
    joy.current.id = null;
    baseRef.current.style.display = 'none';
    if (gameRef.current) gameRef.current.setMove(0, 0);
  }

  // ---- 右: ドラッグでカメラ回転 ----
  function lookDown(e) {
    if (look.current.id !== null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    look.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }
  function lookMove(e) {
    const l = look.current;
    if (e.pointerId !== l.id) return;
    if (gameRef.current) gameRef.current.look(e.clientX - l.x, e.clientY - l.y);
    l.x = e.clientX; l.y = e.clientY;
  }
  function lookUp(e) { if (e.pointerId === look.current.id) look.current.id = null; }

  return (
    <div className="game-root">
      <div className="game-canvas" ref={hostRef} />
      {phase === 'playing' && (
        <div className="game-controls">
          <div className="joy-zone" onPointerDown={joyDown} onPointerMove={joyMove} onPointerUp={joyUp} onPointerCancel={joyUp}>
            <div className="joy-base" ref={baseRef}><div className="joy-knob" ref={knobRef} /></div>
          </div>
          <div className="look-zone" onPointerDown={lookDown} onPointerMove={lookMove} onPointerUp={lookUp} onPointerCancel={lookUp} />
          <button
            className="jump-button"
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); gameRef.current?.setJump(true); }}
            onPointerUp={() => gameRef.current?.setJump(false)}
            onPointerCancel={() => gameRef.current?.setJump(false)}
          >ジャンプ</button>
        </div>
      )}
      <div className="game-topbar">
        <button className="game-chip" onClick={onExit}>← 退出</button>
        <span className="game-title">{server.name}</span>
        <button className="game-chip" onClick={() => setShowLog((v) => !v)}>ログ</button>
      </div>
      {(phase !== 'playing' || showLog) && (
        <div className={`game-log${phase !== 'playing' ? ' big' : ''}`}>
          {lines.map((l, i) => <div key={i} className={`log-${l.kind}`}>{l.text}</div>)}
          {progress && <div className="log-info">{progress}</div>}
          {phase === 'loading' && <div className="log-info">読み込み中…</div>}
          {phase === 'error' && <button className="secondary-button" onClick={onExit}>ホームに戻る</button>}
        </div>
      )}
    </div>
  );
}

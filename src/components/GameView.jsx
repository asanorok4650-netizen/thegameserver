import { useEffect, useRef, useState } from 'react';
import { Game } from '../game/engine.js';
import { fetchServerFile, loadWorldPackage } from '../game/loader.js';
import { buildSceneFromWorld } from '../game/world.js';
import { buildAvatar } from '../avatar/builder.js';
import { serverFileUrl } from '../servers/api.js';
import { CONFIG } from '../config.js';
import { createRoom, getRoomInfo, NetSession } from '../net/session.js';
import { ROOM_CODE_RE } from '../net/protocol.js';
import '../net.css';

const JOY_R = 55;
const tick = () => new Promise((r) => setTimeout(r, 0));
const mb = (n) => (n / 1048576).toFixed(1) + 'MB';

export default function GameView({ server, desc, playerName, onExit }) {
  const hostRef = useRef(null);
  const gameRef = useRef(null);
  const knobRef = useRef(null);
  const baseRef = useRef(null);
  const joy = useRef({ id: null, ox: 0, oy: 0 });
  const look = useRef({ id: null, x: 0, y: 0 });
  const descRef = useRef(desc);
  const sessionRef = useRef(null);
  const sendHzRef = useRef(10);
  const [showNet, setShowNet] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [netMsg, setNetMsg] = useState('');
  const [netRoom, setNetRoom] = useState(null); // { code, host }
  const [netPlayers, setNetPlayers] = useState([]);
  const [phase, setPhase] = useState('loading');
  const [lines, setLines] = useState([]);
  const [progress, setProgress] = useState('');
  const [showLog, setShowLog] = useState(true);
  const [completed, setCompleted] = useState(false);
  const [ruleMessage, setRuleMessage] = useState('');
  const [ruleScore, setRuleScore] = useState(0);

  useEffect(() => {
    let dead = false;
    const ac = new AbortController();
    const game = new Game(hostRef.current);
    gameRef.current = game;
    setCompleted(false);
    setRuleMessage(''); setRuleScore(0);
    const log = (kind, text) => { if (!dead) setLines((l) => [...l.slice(-80), { kind, text }]); };

    (async () => {
      try {
        log('info', `「${server.name}」を取得中…`);
        const bytes = await fetchServerFile(serverFileUrl(server.id), server.size, (a, b) => { if (!dead) setProgress(`${mb(a)} / ${mb(b)}`); }, ac.signal);
        if (dead) return;
        setProgress('');
        log('ok', `ダウンロード完了(${mb(bytes.length)})`);
        await tick();

        log('info', '解析中…');
        await tick();
        const pkg = await loadWorldPackage(bytes, log);
        log('ok', `解析完了: ${pkg.info}`);
        if (pkg.logic?.definition) log('ok', `ロジックを読み込み: ${pkg.logic.definition.name}`);
        else if (pkg.logic?.warning) log('warn', pkg.logic.warning);
        for (const w of pkg.warnings.slice(0, 5)) log('warn', w);
        if (pkg.warnings.length > 5) log('warn', `ほか警告 ${pkg.warnings.length - 5}件`);
        await tick();
        if (dead) return;

        log('info', 'ワールドを構築中…');
        await tick();
        const world = buildSceneFromWorld(pkg.worldJson);
        const s = world.stats;
        log('ok', `パーツ ${s.parts}個(描画 ${s.drawn} / 衝突 ${s.collidable} / トリガー ${s.triggers})`);
        if (!s.spawnFound) log('warn', 'SpawnLocationがありません。原点付近から開始します');
        for (const [k, v] of Object.entries(pkg.report.ignored)) log('warn', `${k} ${v}件は未対応のため表示されません`);
        for (const [k, v] of Object.entries(pkg.report.approx)) log('warn', `${k} ${v}個は箱の形で代用しています`);
        game.setLogic(pkg.logic, {
          onComplete: () => { if (!dead) setCompleted(true); },
          onRestart: () => { if (!dead) setCompleted(false); }
        });
        game.setScripting(pkg.scripting, {
          onMessage: (message) => { if (!dead) { setRuleMessage(message); window.setTimeout(() => { if (!dead) setRuleMessage(''); }, 2600); } },
          onScore: (score) => { if (!dead) setRuleScore(score); },
          onWarning: (message) => log('warn', message)
        });
        game.setEventRules(pkg.eventRules, {
          onMessage: (message) => { if (!dead) { setRuleMessage(message); window.setTimeout(() => { if (!dead) setRuleMessage(''); }, 2600); } },
          onScore: (score) => { if (!dead) setRuleScore(score); },
          onWarning: (message) => log('warn', message)
        });
        game.setRules(pkg.manifest?.rules);
        sendHzRef.current = pkg.manifest?.players?.sendHz || 10;
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

    return () => { dead = true; ac.abort(); sessionRef.current?.leave(); sessionRef.current = null; game.dispose(); gameRef.current = null; };
  }, [server.id]);

  const NET_ERRORS = {
    API_NOT_CONFIGURED: 'サーバーAPIのURLが未設定です',
    room_not_configured: 'Workerにマルチプレイ(Durable Object)が設定されていません',
    not_found: 'ルームが見つかりません',
    busy: 'ルームを作れませんでした。もう一度試してください',
    room_active: 'このネットワークからのルームがまだ残っています。終了してから作り直してください'
  };
  const NET_CLOSED = {
    'host-left': 'ゲーム進行役との接続が終了しました',
    'p2p-failed': 'ホストと直接つながりませんでした(回線の都合の可能性があります)',
    'signal-lost': '接続が切れました',
    closed: 'ルームは終了しました'
  };

  async function startRoom(create) {
    const game = gameRef.current;
    if (!game || sessionRef.current) return;
    try {
      setNetMsg('接続中…');
      let code = joinCode.trim().toUpperCase();
      if (create) { const r = await createRoom(server.id); code = r.roomId; }
      else {
        if (!ROOM_CODE_RE.test(code)) throw new Error('BAD_CODE');
        const info = await getRoomInfo(code);
        if (info.serverId !== server.id) throw new Error('OTHER_SERVER');
        if (info.status === 'closed') throw new Error('CLOSED');
        if (info.status === 'waiting-authority') throw new Error('AUTHORITY_UNAVAILABLE');
        if (info.players >= info.max) throw new Error('FULL');
      }
      const s = new NetSession({
        code, asHost: create, name: playerName || CONFIG.lastUser || 'Player', sendHz: sendHzRef.current,
        getLocal: () => game.getNetState(),
        getTime: () => game.worldTime(),
        onStatus: (t) => setNetMsg(t),
        onReady: (sess) => {
          setNetRoom({ code, host: sess.isHost });
          if (!sess.isHost) game.netClock = () => sess.getNetTime();
          // ホストがスクリプトを動かし、結果をクライアントへ配る。クライアントはスクリプトを動かさない
          game.setNet(sess.isHost ? 'host' : 'client', sess.id, {
            sendTo: (id, m) => sess.sendGame(id, m), broadcast: (m) => sess.broadcastGame(m), sendToHost: (m) => sess.sendGameToHost(m)
          });
        },
        onPlayers: (list) => { setNetPlayers(list); game.netPlayers(list); },
        onSnapshot: (list) => { game.remote.apply(list); game.netSnapshot(list); },
        onGame: (from, m) => game.netGame(from, m),
        onClosed: (reason) => {
          if (sessionRef.current !== s) return;
          sessionRef.current = null; game.netClock = null; game.remote.clear(); game.clearNet();
          setNetRoom(null); setNetPlayers([]); setNetMsg(NET_CLOSED[reason] || '接続が切れました');
        }
      });
      sessionRef.current = s;
      s.connect();
    } catch (e) {
      const m = String(e.message);
      if (m === 'cooldown') { setNetMsg(`ルームを作り直せるまで、あと${e.retryAfter || 1}秒です`); return; }
      setNetMsg(m === 'BAD_CODE' ? 'コードは英数字6文字です' : m === 'OTHER_SERVER' ? '別のサーバーのルームです。そのサーバーを開いてから入力してください'
        : m === 'CLOSED' ? 'そのルームは終了しています' : m === 'FULL' ? 'ルームが満員です' : m === 'AUTHORITY_UNAVAILABLE' ? 'ゲーム進行役が不在のため、現在参加できません' : NET_ERRORS[m] || 'ルームに接続できませんでした');
    }
  }

  function leaveRoom() {
    sessionRef.current?.leave();
    sessionRef.current = null;
    const game = gameRef.current;
    if (game) { game.netClock = null; game.remote.clear(); game.clearNet(); }
    setNetRoom(null); setNetPlayers([]); setNetMsg('');
  }

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
      {phase === 'playing' && !completed && (
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
      {phase === 'playing' && (ruleMessage || ruleScore !== 0) && <div className="game-rule-hud">{ruleMessage && <div className="game-rule-message">{ruleMessage}</div>}{ruleScore !== 0 && <div className="game-rule-score">スコア {ruleScore}</div>}</div>}
      <div className="game-topbar">
        <button className="game-chip" onClick={onExit}>← 退出</button>
        <span className="game-title">{server.name}</span>
        <button className="game-chip" onClick={() => setShowNet((v) => !v)}>{netRoom ? `マルチ ${netPlayers.length}人` : 'マルチ'}</button>
        <button className="game-chip" onClick={() => setShowLog((v) => !v)}>ログ</button>
      </div>
      {showNet && phase === 'playing' && (
        <div className="net-panel">
          {!netRoom ? (
            <>
              <button className="net-btn" onClick={() => startRoom(true)} disabled={!!sessionRef.current}>ルームを作成</button>
              <div className="net-row">
                <input className="net-input" value={joinCode} maxLength={6} placeholder="コード6文字" autoCapitalize="characters" onChange={(e) => setJoinCode(e.target.value.toUpperCase())} />
                <button className="net-btn" onClick={() => startRoom(false)} disabled={!!sessionRef.current}>参加</button>
              </div>
            </>
          ) : (
            <>
              <div className="net-label">ルームコード</div>
              <div className="net-code">{netRoom.code}</div>
              <ul className="net-players">{netPlayers.map((p) => <li key={p.id}>{p.name}{netRoom.host && p.id === sessionRef.current?.id ? '(進行役)' : ''}</li>)}</ul>
              {netRoom.host && <div className="net-note">あなたはゲーム進行役です。退出後も他の参加者のRoomは維持されます</div>}
              <button className="net-btn net-leave" onClick={leaveRoom}>ルームを出る</button>
            </>
          )}
          {netMsg && <div className="net-msg">{netMsg}</div>}
        </div>
      )}
      {completed && (
        <div className="game-clear-overlay" role="dialog" aria-modal="true" aria-labelledby="game-clear-title">
          <div className="game-clear-card">
            <div className="game-clear-mark">★</div>
            <h2 id="game-clear-title">ステージクリア！</h2>
            <p>おめでとうございます！</p>
            <button className="game-replay-button" onClick={() => gameRef.current?.restart()}>もう一度プレイ</button>
            <button className="game-clear-exit" onClick={onExit}>ホームに戻る</button>
          </div>
        </div>
      )}
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

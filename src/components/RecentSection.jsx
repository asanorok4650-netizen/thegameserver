function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return 'サイズ不明';
  return bytes < 1048576
    ? Math.max(1, Math.round(bytes / 1024)) + ' KB'
    : (bytes / 1048576).toFixed(1) + ' MB';
}

export default function RecentSection({ items, query, onOpenFile, onNavigate, onCardClick }) {
  const q = query.trim().toLowerCase();
  const filtered = items.filter((item) => item.name.toLowerCase().includes(q));

  let content;
  if (items.length === 0) {
    content = (
      <div className="empty-card">
        <div className="empty-icon">▧</div>
        <strong>まだゲームがありません</strong>
        <span>RBXL / RBXLX ファイルを開くと、ここに表示されます。</span>
        <button className="secondary-button" onClick={onOpenFile}>ファイルを選択</button>
      </div>
    );
  } else if (filtered.length === 0) {
    content = (
      <div className="empty-card">
        <div className="empty-icon">▧</div>
        <strong>表示できるゲームがありません</strong>
        <span>ファイルを追加するか、検索ワードを変更してください。</span>
      </div>
    );
  } else {
    content = filtered.map((item) => (
      <article className="game-card" key={item.name} onClick={onCardClick}>
        <div className="game-thumb">▧</div>
        <div className="game-info">
          <strong>{item.name}</strong>
          <small>{String(item.format || '').toUpperCase()} • {formatSize(item.size)}</small>
        </div>
      </article>
    ));
  }

  return (
    <section className="section-block" id="recent-section">
      <div className="section-heading">
        <div>
          <h2>最近プレイしたゲーム</h2>
          <p>最近開いたワールドがここに表示されます。</p>
        </div>
        <button className="text-button" onClick={() => onNavigate('recent')}>すべて表示 →</button>
      </div>
      <div className="game-grid" id="recent-games">{content}</div>
    </section>
  );
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return 'サイズ不明';
  return bytes < 1048576
    ? Math.max(1, Math.round(bytes / 1024)) + ' KB'
    : (bytes / 1048576).toFixed(1) + ' MB';
}

function formatDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ja-JP');
}

function EmptyCard({ title, body, action }) {
  return (
    <div className="empty-card">
      <div className="empty-icon">▧</div>
      <strong>{title}</strong>
      <span>{body}</span>
      {action}
    </div>
  );
}

export default function ServersSection({ servers, loading, error, query, onRefresh, onNavigate, onJoin }) {
  const q = query.trim().toLowerCase();
  const filtered = servers.filter((s) => s.name.toLowerCase().includes(q));

  let content;
  if (loading && servers.length === 0) {
    content = <EmptyCard title="読み込み中…" body="サーバー一覧を取得しています。" />;
  } else if (error) {
    content = (
      <EmptyCard
        title="サーバー一覧を取得できません"
        body={error}
        action={
          <div className="button-row">
            <button className="secondary-button" onClick={onRefresh}>再読み込み</button>
            <button className="secondary-button" onClick={() => onNavigate('settings')}>設定を開く</button>
          </div>
        }
      />
    );
  } else if (servers.length === 0) {
    content = (
      <EmptyCard
        title="まだサーバーがありません"
        body="設定ページの「サーバー管理」から rbxl を追加すると、ここに表示されます。"
        action={<button className="secondary-button" onClick={() => onNavigate('settings')}>設定を開く</button>}
      />
    );
  } else if (filtered.length === 0) {
    content = <EmptyCard title="見つかりません" body="検索ワードを変更してください。" />;
  } else {
    content = filtered.map((s) => (
      <article className="game-card" key={s.id} onClick={() => onJoin(s)}>
        <div className="game-thumb">▧</div>
        <div className="game-info">
          <strong>{s.name}</strong>
          {s.description && <small className="game-desc">{s.description}</small>}
          <small>{s.format.toUpperCase()} • {formatSize(s.size)} • {formatDate(s.createdAt)}</small>
        </div>
      </article>
    ));
  }

  return (
    <section className="section-block" id="servers-section">
      <div className="section-heading">
        <div>
          <h2>サーバー</h2>
          <p>参加できるワールドの一覧です。</p>
        </div>
        <button className="text-button" onClick={onRefresh} disabled={loading}>
          {loading ? '更新中…' : '更新 ↻'}
        </button>
      </div>
      <div className="game-grid" id="server-list">{content}</div>
    </section>
  );
}

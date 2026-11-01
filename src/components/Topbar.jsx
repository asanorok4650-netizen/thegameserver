export default function Topbar({ query, onQueryChange, onToggleMenu, user }) {
  return (
    <header className="topbar">
      <button className="mobile-menu" id="mobile-menu" aria-label="メニューを開く" onClick={onToggleMenu}>☰</button>
      <label className="search-box">
        <span>⌕</span>
        <input
          id="search-input"
          type="search"
          placeholder="ゲームを検索..."
          autoComplete="off"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
      </label>
      <div className="top-actions">
        <button className="icon-button" title="通知" aria-label="通知">♧</button>
        <div className="avatar top-avatar">{user ? user.displayName.charAt(0).toUpperCase() : 'G'}</div>
      </div>
    </header>
  );
}

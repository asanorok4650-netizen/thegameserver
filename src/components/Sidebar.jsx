import { NAV_ITEMS } from '../pages.js';

export default function Sidebar({ page, open, onNavigate }) {
  return (
    <aside className={`sidebar${open ? ' open' : ''}`} id="sidebar">
      <a
        className="brand"
        href="#"
        aria-label="RBXL Player ホーム"
        onClick={(e) => { e.preventDefault(); onNavigate('home'); }}
      >
        <span className="brand-mark">R</span>
        <span>RBXL Player</span>
      </a>
      <nav className="main-nav" aria-label="メインメニュー">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.page}
            className={`nav-item${page === item.page ? ' active' : ''}`}
            onClick={() => onNavigate(item.page)}
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-note">ローカルのワールドを<br />ブラウザで楽しもう。</div>
        <div className="profile-mini">
          <div className="avatar">G</div>
          <div><strong>ゲスト</strong><small>ローカルモード</small></div>
        </div>
      </div>
    </aside>
  );
}

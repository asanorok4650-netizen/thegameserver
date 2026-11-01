import { useState } from 'react';
import { PAGES } from './pages.js';
import { useServers } from './hooks/useServers.js';
import Sidebar from './components/Sidebar.jsx';
import Topbar from './components/Topbar.jsx';
import ServersSection from './components/ServersSection.jsx';
import PlaceholderSection from './components/PlaceholderSection.jsx';
import AvatarSection from './components/AvatarSection.jsx';
import SettingsSection from './components/SettingsSection.jsx';
import { useAvatar } from './hooks/useAvatar.js';

export default function App() {
  const [page, setPage] = useState('home');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const servers = useServers();
  const avatar = useAvatar();

  const config = PAGES[page] || PAGES.home;
  const show = (name) => config.sections.includes(name);

  function navigate(next) {
    setPage(next);
    setSidebarOpen(false);
  }

  function handleJoin(server) {
    setStatus('「' + server.name + '」への参加機能は次の開発段階(0.4.x)で実装します。');
  }

  return (
    <div className="app-shell">
      <Sidebar page={page} open={sidebarOpen} onNavigate={navigate} user={avatar.user} />
      <main className="main-area">
        <Topbar
          query={query}
          onQueryChange={setQuery}
          onToggleMenu={() => setSidebarOpen((v) => !v)}
          user={avatar.user}
        />
        <section className="page-content">
          <div className="welcome-row">
            <div>
              <p className="eyebrow">YOUR WORLDS, YOUR WAY</p>
              <h1 id="page-title">{config.title}</h1>
              <p className="subheading" id="page-subtitle">{config.subtitle}</p>
            </div>
          </div>

          {show('servers') && (
            <ServersSection
              servers={servers.servers}
              loading={servers.loading}
              error={servers.error}
              query={query}
              onRefresh={servers.refresh}
              onNavigate={navigate}
              onJoin={handleJoin}
            />
          )}
          {show('friends') && (
            <PlaceholderSection
              id="friends-section"
              title="フレンド"
              description="フレンド機能は今後の開発で追加します。"
              icon="♧"
              heading="フレンド機能は準備中です"
              body="オンライン状態や招待機能を、マルチプレイ機能とあわせて実装する予定です。"
            />
          )}
          {show('discover') && (
            <PlaceholderSection
              id="discover-section"
              title="探索"
              description="ゲームの検索・発見機能は今後追加します。"
              icon="◈"
              heading="探索ページは準備中です"
              body="公開ワールドや共有されたワールドを探せるようにする予定です。"
            />
          )}

          {show('avatar') && <AvatarSection avatar={avatar} />}
          {show('settings') && <SettingsSection servers={servers.servers} onServersChanged={servers.refresh} />}

          <p className="status-message" id="status-message" role="status" aria-live="polite">{status}</p>
          <footer>RBXL Player <span>•</span> Browser-based world player</footer>
        </section>
      </main>
    </div>
  );
}

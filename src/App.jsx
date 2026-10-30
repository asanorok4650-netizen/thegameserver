import { useRef, useState } from 'react';
import { PAGES } from './pages.js';
import { useLibrary } from './hooks/useLibrary.js';
import Sidebar from './components/Sidebar.jsx';
import Topbar from './components/Topbar.jsx';
import RecentSection from './components/RecentSection.jsx';
import LibrarySection from './components/LibrarySection.jsx';
import PlaceholderSection from './components/PlaceholderSection.jsx';
import AvatarSection from './components/AvatarSection.jsx';
import SettingsSection from './components/SettingsSection.jsx';
import { useAvatar } from './hooks/useAvatar.js';

export default function App() {
  const [page, setPage] = useState('home');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const fileInputRef = useRef(null);
  const { items, addFile } = useLibrary();
  const avatar = useAvatar();

  const config = PAGES[page] || PAGES.home;
  const show = (name) => config.sections.includes(name);

  function navigate(next) {
    setPage(next);
    setSidebarOpen(false);
  }

  function openFile() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e) {
    const input = e.target;
    const file = input.files && input.files[0];
    if (!file) return;
    const extension = file.name.split('.').pop().toLowerCase();
    if (extension !== 'rbxl' && extension !== 'rbxlx') {
      setStatus('対応しているファイルは .rbxl / .rbxlx です。');
      return;
    }
    const result = addFile(file, extension);
    setStatus(
      result.ok
        ? file.name + ' をライブラリに追加しました。※現在は画面表示のみで、ゲームの解析・実行機能は未実装です。'
        : 'ブラウザに保存できませんでした。ブラウザの保存設定をご確認ください。'
    );
    input.value = '';
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
            <button className="primary-button" id="open-file-button" onClick={openFile}>
              <span>＋</span> ゲームを開く
            </button>
            <input
              ref={fileInputRef}
              id="file-input"
              type="file"
              accept=".rbxl,.rbxlx"
              hidden
              onChange={handleFileChange}
            />
          </div>

          {show('recent') && (
            <RecentSection
              items={items}
              query={query}
              onOpenFile={openFile}
              onNavigate={navigate}
              onCardClick={() => setStatus('RBXLの解析・実行機能は次の開発段階で実装します。')}
            />
          )}
          {show('library') && <LibrarySection onOpenFile={openFile} />}
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
          {show('settings') && <SettingsSection />}

          <p className="status-message" id="status-message" role="status" aria-live="polite">{status}</p>
          <footer>RBXL Player <span>•</span> Browser-based world player</footer>
        </section>
      </main>
    </div>
  );
}

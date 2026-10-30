# RBXL Player — Home UI v0.2 (React / Vite)

v0.2 のデザイン(CSS・クラス名・DOM構造)をそのまま React + Vite に移行したものです。
`src/style.css` は旧版の `style.css` を一切変更していません。

## 開発
```bash
npm install
npm run dev      # 開発サーバー
npm run build    # dist/ に本番ビルド
```

## Cloudflare Pages へ公開(GitHub連携)
1. このフォルダの中身をGitHubリポジトリのルートにpush(`node_modules` と `dist` は `.gitignore` 済み)
2. Cloudflare ダッシュボード → Workers & Pages → Create → Pages → Connect to Git
3. ビルド設定:
   - Framework preset: `React (Vite)` または None
   - Build command: `npm run build`
   - Build output directory: `dist`
4. 以降は GitHub に push するたびに自動デプロイされます。

## 構成
```
src/
  main.jsx            エントリ
  App.jsx             ページ状態・ファイル選択・ステータス
  pages.js            ページ/ナビ定義(旧 navigation.js)
  hooks/useLibrary.js localStorage管理(旧 library.js)
  components/         Sidebar / Topbar / RecentSection / LibrarySection / PlaceholderSection
  style.css           旧版CSSそのまま
```

## 注意
localStorageのキー(`rbxl-player-recent-v1`)は旧版と同じです。
RBXLの解析・3D描画・スクリプト実行・マルチプレイは未実装です。

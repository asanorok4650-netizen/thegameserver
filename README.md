# RBXL Player v0.3 (React / Vite) — ホーム + アバターローダー

v0.2のホームUI(React化したデザイン)に、パーツ組み立て式のアバターローダーを追加したものです。
`src/style.css` は変更していません。追加スタイルは `src/avatar.css` に分けています。

## 開発
```bash
npm install      # three を追加したので、初回は必ず実行(package-lock.json が更新されます)
npm run dev
npm test         # パーサ/リグ/ビルダーのロジックテスト(three不要)
npm run build
```
> `package-lock.json` を更新したらコミットしてください。更新しないと Cloudflare Pages の `npm ci` が失敗することがあります。

## ユーザー読み込みの準備(Roblox APIプロキシ)
ブラウザからRoblox APIは直接叩けないため、`worker/proxy.js` を別途 Cloudflare Workers にデプロイします。
```bash
npx wrangler deploy          # wrangler.toml の main = worker/proxy.js
```
デプロイ後、アプリの「設定」ページにWorkerのURLを入力 → 接続テスト。
`wrangler.toml` の `ALLOWED_ORIGIN` に公開先(Pagesのドメイン)を入れると、そのサイトからのみ許可できます。

## 構成(追加分)
```
src/
  config.js                 設定(プロキシURL・PixelRatio。localStorage)
  hooks/useAvatar.js        アバターの状態と読み込み(Appで保持)
  components/
    AvatarSection.jsx       アバターページ(入力・デモ・パーツ一覧・アセット一覧)
    AvatarStage.jsx         Three.jsステージのReactラッパー(生成/破棄)
    SettingsSection.jsx     設定ページ
  avatar/                   rigs(リグ/服UV) builder(組み立て) api(取得) demo stage(3D)
  rbx/                      lz4 rbxm(バイナリ解析) mesh(v1〜v5) accessory(抽出)
  avatar.css
worker/proxy.js             CORSプロキシ(Cloudflare Worker)
test/                       Nodeで動くテスト(three/DOMはスタブ)
```

## 対応状況
- 対応: R6/R15、BodyColors、スケール、Shirt/Pants/T-Shirt(XML・バイナリ)、顔、アクセサリ(Handle+メッシュv1〜v5+テクスチャ)
- 未対応: レイヤード服、体パーツ(メッシュ頭など)、メッシュv6/v7、ZSTD圧縮のrbxm、R15の正確なパーツサイズ(近似値)
- アクセサリの取り付け位置(ボディ側アタッチメント)は近似値です。実アバターで確認しながら調整します。

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

## ユーザー読み込みの準備(Cloudflare Worker + APIキー)
ブラウザからRoblox APIは直接叩けないため、`worker/proxy.js` を Cloudflare Workers にデプロイします。
また、2025-04-02以降 Roblox の Asset Delivery は**認証なしだと401**を返すため、服・アクセサリなどアセットの取得には
**Open Cloud の APIキー**が必要です。キーは**画面には入力せず、Workerのシークレットとして保存**します
(ブラウザに入れたキーは誰でも見られてしまうため)。

### 1. Workerをデプロイ
```bash
npx wrangler deploy          # wrangler.toml の main = worker/proxy.js
```
(ダッシュボードの「Edit code」に `worker/proxy.js` を貼る方法でも可)

### 2. APIキーを作る
1. Roblox の Creator Dashboard → Open Cloud → API Keys → 「Create API Key」
2. Access Permissions で、スコープ `legacy-asset:manage`(Asset Delivery)が使えるAPI Systemを追加
3. キーは**個人ユーザーのもの**を使う(グループのキーは不可)。公開アセットだけなら権限はこれだけで足ります
4. IPアドレス制限は、Cloudflareの送信元IPが固定でないため空(0.0.0.0/0)のままにする

### 3. キーをWorkerのシークレットに保存(リポジトリには絶対に書かない)
```bash
npx wrangler secret put ROBLOX_API_KEY      # 貼り付けて Enter
```
またはダッシュボード → Workers → 対象Worker → Settings → 「Variables and secrets」→ Add → Type: **Secret**、名前 `ROBLOX_API_KEY`。
(シークレットは再デプロイしても消えません。`wrangler.toml` の `[vars]` には書かないでください)

### 4. 確認
アプリの「設定」→ プロキシURLを入れて「接続テスト」。`APIキー: 設定済み` と出ればOKです。
アセットが取得できないときは、アバター画面の「アセット」一覧にエラーの理由が出ます
(`APIキーが設定されていません` / `無効か期限切れ` / `回数制限` など)。

### 5. 公開するとき(任意)
`wrangler.toml` の `[vars]` に `ALLOWED_ORIGIN = "https://あなたのサイト"` を入れると、そのサイトからのリクエストだけ受け付けます。
ブラウザ以外はOriginを偽装できるため、これだけでは完全な保護ではありません。キーのレート制限(1分あたり1000回)を
使い切られないよう、不安な場合はCloudflareのレート制限ルールも併用してください。
なお、取得したアセットはWorkerのエッジキャッシュに保存して、キーの利用回数を節約します
(`*.workers.dev` でキャッシュが効くかは未確認。独自ドメインなら有効です)。

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
worker/proxy.js             /asset/{id}(APIキー付きアセット取得)・/health・公開APIの中継
test/                       Nodeで動くテスト(three/DOMはスタブ)
```

## 対応状況
- 対応: R6/R15、BodyColors、スケール、Shirt/Pants/T-Shirt(XML・バイナリ)、顔、アクセサリ(Handle+メッシュv1〜v5+テクスチャ)
- 未対応: レイヤード服、体パーツ(メッシュ頭など)、ZSTD圧縮のrbxm(メッシュv6/v7は対応済み。v7のDracoデコーダは `public/draco/` に同梱)、R15の正確なパーツサイズ(近似値)
- アクセサリの取り付け位置(ボディ側アタッチメント)は近似値です。実アバターで確認しながら調整します。

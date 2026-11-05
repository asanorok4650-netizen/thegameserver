# thegameserver (RBXL Player) v0.3.2

Roblox風のワールドをブラウザで作成・公開・プレイするためのプラットフォームです。React + Vite + Three.js を基盤とし、RBXL / RBXLX の読み込み、独自ワールド形式 `.tgw`、ブラウザ内Studio、組み込みスクリプト、ホストレスP2Pマルチプレイに対応しています。

> **開発状況:** マルチプレイは現在「位置・向きの共有」を中心とした初期段階です。HP・スコア・パーツ変更・スクリプト実行結果など、ゲーム進行状態の全員同期はまだ接続されていません。

## 主な機能

- **ホーム / ワールド一覧:** 管理者がCloudflare R2 + D1へ登録したワールドを一覧表示。一般ユーザー向けの自由アップロード機能はありません。
- **アバター:** Robloxユーザー名からアバターを取得し、R6 / R15などのパーツをThree.jsで組み立てて表示。
- **ワールドプレイヤー:** RBXL / RBXLX と `.tgw` を読み込み、ブラウザ内でプレイ。
- **Studio:** ブラウザ上でパーツを編集し、Undo / Redo、ローカル下書き、`.tgw` の書き出し・公開。
- **ゲームルール:** 重力・歩行速度・ジャンプ力、環境設定、動く足場・回転床・コンベアなど。
- **ビジュアルスクリプト:** Blocklyでイベント処理を組み立て、制限付きIRインタープリターで実行。任意JavaScriptは評価しません。
- **マルチプレイ:** Cloudflare Durable Objectsをシグナリングに利用し、WebRTC DataChannelでプレイヤー位置を直接交換するホストレスP2P。

## 技術スタック

| 領域 | 技術 |
|---|---|
| UI | React 18 |
| ビルド / 開発 | Vite 5 |
| 3D | Three.js |
| ワールド圧縮 | fflate (ZIP) |
| ビジュアルスクリプト | Blockly |
| 公開API | Cloudflare Workers |
| ワールドファイル | Cloudflare R2 |
| ワールド一覧・制限情報 | Cloudflare D1 |
| ルーム・シグナリング | Cloudflare Durable Objects (SQLite-backed) |
| プレイヤー間通信 | WebRTC DataChannel |

## 開発環境

必要: Node.js / npm

```bash
npm install
npm run dev
```

開発サーバー起動後、Viteが表示するURLをブラウザで開きます。

```bash
npm test       # パーサー、ワールド、Studio、API、ネットワーク等のテスト
npm run build  # 本番ビルド (dist/)
npm run preview
```

Cloudflare Pagesで公開する場合は、ビルドコマンドを `npm run build`、出力ディレクトリを `dist` にします。

## ワールド形式

### RBXL / RBXLX

Roblox Studioのワールドファイルを読み込みます。解析後は共通の `worldJson` に変換してシーンを構築します。RBXLの全機能を完全再現するものではなく、未対応アセットや物理・アバター表現には近似があります。

### .tgw (thegameserver World Package)

`.tgw` はZIPベースのワールドパッケージです。基本構成:

- `manifest.json`: 名前、作者、形式バージョン、プレイヤー設定、ルール、ロジック設定など
- `world.json`: スポーン地点、パーツ、環境など
- 任意のアセットファイル

現在の形式バージョンは `1.0`。座標単位はstuds、上方向は+Yです。パッケージ内に任意のJavaScriptコードは格納・実行せず、組み込みロジックIDとパラメータを参照します。ZIP展開・形式検証・サイズ上限チェックはブラウザ側で行います。

## Studioとゲームロジック

Studioはワールドの作成・編集・公開を行います。編集内容の下書きはブラウザのIndexedDBに保存され、公開時にWorker APIへ送信されます。

組み込み機能の例:

- 物理ルール: `walkSpeed` / `jumpPower` / `gravity`
- パーツ振る舞い: `spinner` / `mover` / `bounce` / `conveyor`
- Obbyタグ: `kill` / `checkpoint` / `goal`
- Blocklyイベント: start / spawn / touch / leave / interval など
- プレイヤー・パーツのプロパティ、スコア、メッセージ、テレポート、復活など

スクリプトは許可された命令を表すIRへ変換し、実行量・タスク数・繰り返し回数などに上限を設けたRuntimeで処理します。

## マルチプレイ (ホストレスP2P)

現在の方式は**ホストなしのフルメッシュ**です。参加者は対等で、特定のプレイヤーをAuthority / ホストとして選出しません。

### 接続構成

1. Worker上のDurable Object `Room` がルーム作成・参加者名簿・退出通知を管理。
2. RoomがWebSocket経由でSDP / ICEシグナリングを参加者間で中継。
3. 各ブラウザがWebRTC DataChannelで他の参加者と直接接続。
4. ゲームの位置データはP2Pで交換し、Durable Objectへ中継しません。

### 同期データ

- プレイヤーの位置・向き・速度・接地フラグ
- 状態パケットは16バイトのバイナリ。位置は1/64 stud単位、向きはuint16。
- 通常の送信頻度は10Hz (設定範囲5〜30Hz)。停止中は500ms間隔に抑制。
- 受信側は連番で古いパケットを除外し、最新状態を表示に利用。

### ルーム・再接続

- 最大8人。参加順に `p1`, `p2` ... のIDを割り当てます。
- 接続開始時は先に参加した側が後から参加した側へofferを送ります。
- P2Pが切れた相手には1 / 2 / 4 / 8 / 15秒後の最大5回まで再接続を試みます。
- シグナリングWebSocketが切れても成立済みP2Pは維持し、再接続用tokenでRoomへ復帰します。
- Room内の世界時刻を基準にし、動く床など時刻ベースの振る舞いを揃えます。時刻の再同期は参加時に複数回、その後10分ごとに行います。
- 全員のWebSocketが切れた場合は45秒の復帰猶予後にRoomを破棄。空のRoomは60秒で破棄します。

### 現在の制約・未実装

- **ゲーム進行状態は未同期:** HP、スコア、スクリプト結果、パーツの変更、クリア状態などは全員に共有されません。各端末で個別にゲームロジックが動きます。
- **TURNサーバー未設定:** 現状はCloudflare STUNのみです。ネットワーク環境によってはP2P接続できない場合があります。
- **フルメッシュ:** 最大7本の相手接続を各クライアントが維持します。大人数向けの中継・分割メッシュは未実装です。
- **位置は信用ベース:** サーバー側で移動の正当性を検証する仕組みはありません。
- ページ再読み込み時は新しい参加者として入り直します。

この方式ではAuthority引き継ぎは行いません。今後、共有HP・スコア・ワールド変更などの権限が必要になった段階で、権限モデルと状態同期を別途設計します。

## Cloudflare Workerのセットアップ

Workerの設定ファイルは `worker/wrangler.toml` です。R2、D1、Durable Objectsのバインディングが定義されています。

### 1. Cloudflareリソース

必要なリソース:

- R2 bucket: `rbxl-servers`
- D1 database: `rbxl-servers-db`
- Durable Object: `Room` (SQLite-backed)

既存環境を新規構築する場合は、Cloudflareのリソースを作成し、実際に発行されたD1 database IDを `worker/wrangler.toml` に設定してください。

```bash
cd worker
npx wrangler r2 bucket create rbxl-servers
npx wrangler d1 create rbxl-servers-db
npx wrangler d1 execute rbxl-servers-db --remote --file=./schema.sql
npx wrangler secret put ADMIN_PASSPHRASE
npx wrangler deploy
```

Durable ObjectsのSQLite migration設定も `worker/wrangler.toml` に含まれています。既存環境では設定済みmigrationとリソースを確認してからデプロイしてください。

### 2. Worker API

主なHTTP API:

| Method | Path | 用途 |
|---|---|---|
| GET | `/api/health` | 接続・設定状態 |
| GET | `/api/servers` | 公開ワールド一覧 |
| GET | `/api/servers/:id/file` | ワールドファイル取得 |
| POST | `/api/servers` | ワールド追加 (管理用合言葉が必要) |
| PUT | `/api/servers/:id` | ワールド更新 (管理用合言葉が必要) |
| DELETE | `/api/servers/:id` | ワールド削除 (管理用合言葉が必要) |
| POST | `/api/rooms` | マルチプレイルーム作成 |
| GET | `/api/rooms/:code/info` | ルーム情報 |
| WebSocket | `/api/rooms/:code/ws` | 参加・再接続・シグナリング・時刻同期 |

ルーム作成には同一IP由来の制限があります。同時に1ルーム、ルーム終了後2分のクールダウンが基本です。管理用合言葉を使ったリクエストは検証用にこの制限を受けません。制限状態はD1の `room_limits` を使います。

### 3. 接続先の設定

`src/config.js` の既定値を利用できます。接続先の優先順位:

1. アプリの設定画面で保存した値
2. ビルド時環境変数 `VITE_API_BASE` / `VITE_PROXY_BASE`
3. `src/config.js` の `DEFAULTS`

`VITE_*` の値はブラウザへ公開されます。APIキーや管理用合言葉などの秘密情報を設定しないでください。管理用合言葉はWorker Secretの `ADMIN_PASSPHRASE` に設定します。

公開時は `worker/wrangler.toml` の `ALLOWED_ORIGIN` を実際のサイトURLに合わせてください。

### 4. Robloxアバター用プロキシ

`src/config.js` には既定のプロキシURLがあります。プロキシの実装・デプロイはゲーム一覧Workerとは別です。APIキーが必要なアセット取得では、キーをブラウザやリポジトリに置かず、プロキシWorkerのSecretとして管理してください。プロキシの実際のソース配置・デプロイ先は利用中の環境で確認してください。

## ディレクトリ構成

```
src/
  avatar/       Robloxアバター取得・組み立て・表示
  rbx/          RBXL/RBXM解析、メッシュ・アクセサリ
  components/   React画面・UI
  game/         ゲームループ、ワールド構築、衝突、移動
  studio/       ワールド編集、履歴、保存、公開
  tgw/          .tgw読み書き・検証
  logics/       組み込みゲームロジック
  behaviors/    パーツ振る舞い
  scripting/    Blocklyコンパイラー、IR、Runtime
  net/          P2Pプロトコル、セッション、時計
  servers/      公開ワールド一覧/APIクライアント
worker/
  index.js      ワールドAPI・Durable Object Room
  room-limit.js ルーム作成制限
  schema.sql    D1スキーマ
  wrangler.toml Cloudflare設定
test/           Node.jsテスト
docs/
  DEVELOPMENT.md 開発者向け詳細仕様
  MULTIPLAYER-SERVER-BROWSER.md サーバー一覧・参加割当の設計（未実装）
```

## 関連ドキュメント

- [開発者向けガイド](docs/DEVELOPMENT.md) — ワールド形式、ゲームエンジン、Studio、スクリプト、ネットワーク仕様
- [マルチプレイサーバー一覧・参加導線の設計](docs/MULTIPLAYER-SERVER-BROWSER.md) — GameLobby DO、Room予約ticket、作成制限を維持した参加処理（**設計のみ・未実装**）
- [Cloudflare Worker設定](worker/wrangler.toml)
- [パッケージ定義・テストコマンド](package.json)

## 開発上の注意

- 実装とドキュメントが食い違う場合は、コードを正としてドキュメントを更新してください。
- ワールド形式を変更した場合は、検証処理・Studio入出力・テスト・ドキュメントをまとめて確認してください。
- WorkerのSecretやAPIキーをコミットしないでください。
- ネットワーク仕様を変更した場合は、`src/net/` と `worker/index.js` の両方、および `test/net-*.test.mjs` を確認してください。
- 実機で確認していない機能を「動作確認済み」と記載しないでください。

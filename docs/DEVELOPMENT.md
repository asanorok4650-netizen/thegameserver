# 開発者向けガイド

この文書は、現在の安定版ブランチ `feature/capsule-player-collision` の実装を基準にしています。
将来の変更で実装と説明がずれた場合は、コードを正としてこの文書も更新してください。

## 1. プロジェクト概要

RBXL Player は React + Vite + Three.js で動作するブラウザベースのワールドプレイヤーです。

主な機能領域:

- ホーム/UI: `src/App.jsx`、`src/components/`
- アバター読み込み・組み立て: `src/avatar/`、`src/rbx/`
- Studio (ワールド編集): `src/studio/`
- ゲーム実行・描画・移動: `src/game/`
- ワールドパッケージ (.tgw): `src/tgw/`
- 組み込みゲームロジック: `src/logics/`
- 公開ワールドの一覧/API: `src/servers/`、`worker/`

現状のゲームプレイはブラウザ内の単一プレイヤー実行です。`manifest.players.max` や `sendHz` はパッケージのメタデータであり、このブランチにリアルタイムマルチプレイヤー同期機能が実装されていることを意味しません。

## 2. 開発環境

必要なもの:

- Node.js (ES modules を利用)
- npm
- Git

基本コマンド:

```bash
npm install
npm run dev
npm run build
npm test
```

`npm run dev` は Vite の開発サーバーを起動します。`npm run build` は本番用ファイルを `dist/` に生成します。

> 注意: このブランチの `package.json` の test スクリプトは `test/worker.test.mjs` と `test/api.test.mjs` も参照していますが、現在のリポジトリツリーにはこれらのファイルがありません。テストを実行する際は、その時点のファイル一覧とスクリプトを確認してください。個別テストは `node test/<name>.test.mjs` で実行できます。Three.js のスタブが必要なテストでは `node --import ./test/register.mjs test/<name>.test.mjs` を使います。

## 3. ゲーム起動からワールド表示まで

主な流れ:

1. `src/components/GameView.jsx` がサーバーのファイルURLからバイト列を取得。
2. `src/game/loader.js` の `loadWorldPackage()` がファイル形式を判別。
3. RBXL は `src/rbx/rbxm.js` などで解析し、`treeToWorldJson()` で共通形式へ変換。
4. TGW は `src/tgw/container.js` で ZIP を読み、manifest/world JSON を検証。
5. `src/game/world.js` の `buildSceneFromWorld()` が Three.js の描画オブジェクト、衝突ワールド、トリガー、スポーン位置を構築。
6. `Game` (`src/game/engine.js`) がワールド、アバター、ロジックを使って毎フレーム更新・描画。

形式が違っても、読み込み後は共通の `worldJson` を使ってシーンを作る設計です。

## 4. ゲームエンジンと衝突判定

### `src/game/engine.js`

ゲームループ、入力、重力、ジャンプ、カメラ、アバター配置、ロジック呼び出しを担当します。

- 移動入力: キーボードと画面上の仮想スティック
- ジャンプ: Space キーまたは画面上のジャンプボタン
- 重力・移動: `update(dt)`
- 衝突解決: `_resolve()` から `CollisionWorld.pushOutCapsule()` を呼ぶ
- トリガー接触: `_checkTriggers()`
- スポーン復帰: `respawn()`

### `src/game/collision.js`

Three.js に依存しない衝突処理です。ワールド構築時に `CollisionWorld` へ衝突対象を登録します。

現在のプレイヤー衝突形状:

- 箱との衝突は、垂直な線分と半径からなるカプセルとして扱います。
- 球パーツはカプセル軸の最近接位置を使って球同士の重なりを解決します。
- くさび・角くさびは既存の凸形状判定を複数の高さで使う近似処理です。完全なカプセル対凸多面体判定ではありません。
- 旧来の球判定 `pushOut()` は空間グリッドで候補を絞ります。一方、現在のカプセル判定 `pushOutCapsule()` は登録済み衝突パーツを走査します。大規模ワールドで負荷が問題になった場合は、カプセル用の候補絞り込みを検討してください。
- タグ付きパーツの接触判定は衝突応答とは別で、`sphereIntersectsOBB()` を使います。現在のトリガー判定はプレイヤーの複数高さの球で接触を近似しています。

衝突形状や押し出し処理を変更する場合は、少なくとも床・壁・角・天井・球・くさび・足場端で確認してください。衝突応答とタグのトリガー判定は別系統です。

## 5. ワールドデータと .tgw

`.tgw` は ZIP ベースのワールドパッケージです。最低限、次の2ファイルを含みます。

- `manifest.json`: パッケージ情報、ワールドファイル名、パーツ数、ゲームロジック設定など
- `world.json`: スポーンとパーツの配列

### manifest の主な項目

- `formatVersion`: manifest 形式バージョン (現在 `1.0`)
- `name` / `description` / `author` / `generator`
- `players.max` / `players.sendHz`
- `world.file`: world JSON のパス
- `world.partCount`: パーツ数
- `world.bounds`: ワールド境界
- `logic`: 任意の組み込みロジックID・バージョン・パラメータ
- `source`: RBXL 変換時の近似・未対応情報

### world.json の基本構造

```json
{
  "formatVersion": "1.0",
  "units": "studs",
  "up": "+Y",
  "spawns": [
    { "pos": [0, 1, 0], "size": [6, 1, 6] }
  ],
  "parts": [
    {
      "id": "p1",
      "name": "Platform",
      "shape": "block",
      "size": [8, 1, 8],
      "pos": [0, 0, 0],
      "rot": [1, 0, 0, 0, 1, 0, 0, 0, 1],
      "color": "#6b8e4e",
      "transparency": 0,
      "collide": true,
      "tags": [],
      "attrs": {}
    }
  ]
}
```

座標・サイズの単位は studs、上方向は +Y です。回転行列 `rot` は9要素です。形状は `block`、`ball`、`cylinder`、`wedge`、`corner` を使います。

検証・上限・ZIP読み書きは `src/tgw/validate.js` と `src/tgw/container.js` が担当します。読み込み時は ZIP のパス、重複エントリ、展開サイズ、形式バージョン、manifest と world のパーツ数などを検証します。

## 6. 組み込みロジック

ゲーム固有ルールをエンジン本体に直接書かず、`src/logics/` に分離しています。

- `src/logics/types.js`: ロジック定義の型情報 (JSDoc)
- `src/logics/index.js`: 定義一覧、ID検索、パラメータ解決、Runtime factory 登録
- `src/logics/obby/index.js`: Obby の設定定義
- `src/logics/obby/runtime.js`: Obby の実行時ルール

### 現在の Obby 設定

`logic.id` は `obby`。パラメータ `killY` は落下判定の Y 座標です (既定値 -50)。

利用可能なパーツタグ:

| タグ | 動作 |
|---|---|
| `kill` | 接触時に現在のスポーン地点へ戻す |
| `checkpoint` | そのパーツ上面付近を次の復帰地点にする |
| `goal` | クリア状態にし、ゲーム操作を停止する |

新しいロジックを追加する場合:

1. `src/logics/<id>/index.js` に宣言的な定義を作る。
2. `src/logics/<id>/runtime.js` に Runtime factory を作る。
3. `src/logics/index.js` の `LOGICS` と `runtimes` Map の両方へ登録する。
4. Runtime はエンジン内部に直接依存せず、渡される API (respawn / setCheckpoint / complete など) を通じて操作する。
5. 定義・パラメータ解決・Runtime のテストを追加する。

.tgw に実行可能コードは格納しません。パッケージにはロジックIDと設定値だけを保存し、実際のコードはプレイヤー側の組み込みRuntimeが提供します。

## 7. Studio

Studio の主要な責務:

- `src/studio/model.js`: ワールドドキュメントの純粋なデータ操作、変換、公開前チェック
- `src/studio/history.js`: Undo / Redo
- `src/studio/storage.js`: IndexedDB によるローカル下書き保存
- `src/studio/io.js`: .tgw の読み込み・書き出し・公開
- `src/studio/useStudio.js`: React 状態、履歴、下書き、公開操作の統合
- `src/studio/StudioPage.jsx`: Studio UI
- `src/studio/viewport.js` / `pick.js` / `Transform.jsx`: 3Dビュー、選択、変形UI

下書き保存はブラウザ内のみです。サーバーへ通信するのは公開処理です。公開時は `publishDoc()` が .tgw を作成し、Worker API に POST (新規) または PUT (更新) します。

## 8. Cloudflare の構成

`worker/index.js` はサーバー一覧とワールドファイルを扱う Worker API です。

- D1: サーバーのメタデータ (`worker/schema.sql`)
- R2: .rbxl / .rbxlx / .tgw のファイル本体
- Worker: 一覧取得、ファイル取得、管理者認証付き追加・更新・削除

主な API:

| Method | Path | 用途 |
|---|---|---|
| GET | `/api/health` | 接続・設定状態 |
| GET | `/api/servers` | 一覧 |
| GET | `/api/servers/:id/file` | ファイル取得 |
| POST | `/api/servers` | 新規追加 (合言葉必須) |
| PUT | `/api/servers/:id` | 同じIDのファイル更新 (合言葉必須) |
| DELETE | `/api/servers/:id` | 削除 (合言葉必須) |

Worker の環境設定は `worker/wrangler.toml` を参照してください。管理用合言葉は Wrangler Secret の `ADMIN_PASSPHRASE` に設定し、ソースコードや `[vars]` に書かないでください。D1 の database ID も実環境の値を使います。

アバター用 Roblox API プロキシは別機能です。現在の README に記載された `worker/proxy.js` は、リポジトリツリーに存在しないため、その手順を使う前に実際の配置・デプロイ設定を確認してください。

## 9. テストと変更時の確認

主なテストファイル:

- `test/obby-runtime.test.mjs`: Obby Runtime
- `test/logics.test.mjs`: ロジック定義・解決
- `test/tgw.test.mjs`: .tgw の検証・読み書き
- `test/studio.test.mjs`: Studio モデル・履歴など
- `test/mesh.test.mjs`、`test/rbxm.test.mjs`、`test/rigs.test.mjs`: アバター/RBXM関連

変更領域ごとの確認:

- ゲーム移動・衝突: 平地、床端、壁、角、天井、球、くさび、ジャンプ、落下復帰
- ロジック: kill / checkpoint / goal / killY / restart
- .tgw: 正常ファイル、形式違い、壊れたZIP、パーツ数不一致、サイズ上限
- Studio: 新規作成、編集、Undo/Redo、下書き復元、書き出し、再読み込み、公開
- Worker: health、一覧、ファイル取得、認証、追加、更新、削除

実機確認前に「動作確認済み」とは扱わないでください。特にSafari/iPadのタッチ操作・WebGL・パフォーマンスはブラウザ実機で確認します。

## 10. 開発上の注意

- ゲーム固有ルールは `src/logics/` に置き、`engine.js` にロジックIDごとの分岐を増やさない。
- RBXL と TGW の読み込み後は共通の `worldJson` を利用する。
- `world.json` の仕様を変えたら `validate.js`、`worldjson.js`、Studio入出力、テスト、ドキュメントを同時に確認する。
- Worker の秘密情報をコミットしない。
- 変更は機能単位のブランチで行い、安定版ブランチへ直接実装を積まない。

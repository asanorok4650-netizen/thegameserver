# マルチプレイサーバー一覧・参加導線 設計 / 引き継ぎ

> 状態: **設計確定・未実装**
>
> 対象ブランチ: `feature/server-lobby-browser`
> 設計の起点: `feature/do-traffic-optimization`（`fe4f161`）
>
> この文書は実装担当者向けの引き継ぎ資料です。ここに記載した新API・GameLobby Durable Object・予約ticketは提案する実装仕様であり、まだリポジトリに実装されていません。既存コードの仕様と混同しないでください。

## 1. 目的・ユーザー体験

現在はゲーム画面内でRoom IDを入力するか、新規Roomを作成して参加します。これを、一般ユーザーがRoom IDを知らなくても参加できる流れに変更します。

目標の操作:

1. ホームのワールド一覧でゲームを選択する。
2. そのゲーム専用のサーバー一覧を表示する。
3. 各サーバーカードにRoom ID、参加人数（例: `3 / 8`）、参加者の一部（表示名を最大4人程度）を表示する。
4. ユーザーは特定サーバーの「このサーバーに参加」か、「空いているサーバーに参加」を選ぶ。
5. 参加可能なRoomが1つもない場合は、新規Roomを作成して参加する。
6. 新規作成が現行のRoom作成制限で拒否された場合は、待機理由と再試行可能時間をUIに表示する。制限を迂回して自動作成してはならない。

通常の参加操作でRoom IDを手入力させないことを目標にします。Room IDはサーバーカード上に表示し、トラブル調査や開発用の識別情報として利用できます。

## 2. 既存実装（変更前に守ること）

### 2.1 現行API / Durable Object

実装場所は主に次のファイルです。

- `worker/index.js`: Worker APIと `Room` Durable Object
- `worker/room-limit.js`: D1を使ったRoom作成制限
- `worker/schema.sql`: D1スキーマ
- `worker/wrangler.toml`: Cloudflare binding / migration
- `src/net/session.js`: ブラウザ側Room作成・参加とP2Pセッション
- `src/components/GameView.jsx`: ゲーム読み込みとマルチプレイ接続UI
- `src/components/ServersSection.jsx` / `src/App.jsx`: ホームのワールド一覧と選択

現在の主要Room API:

| Method | Path | 現在の役割 |
|---|---|---|
| POST | `/api/rooms` | `{ serverId }` を受け取りRoomを作成。成功時は `{ roomId }` |
| GET | `/api/rooms/:code/info` | `{ serverId, status, players, max }` を返す |
| WebSocket | `/api/rooms/:code/ws` | 入室・再接続、名簿通知、SDP/ICE中継、Room基準時刻 |

Roomはゲームデータの中継サーバーではありません。Roomは参加者名簿、WebRTCシグナリング、時刻基準を担当し、位置などのゲームデータは各ブラウザ間のWebRTC DataChannelで直接交換します。新機能を追加してもこの責務分担は維持します。

### 2.2 Roomの現在の上限・寿命

現行コードの値:

| 項目 | 現在値 | 意味 |
|---|---:|---|
| Room最大人数 | 8 | 実接続中の参加者上限 |
| 未参加Roomの寿命 | 60秒 | 作成後、誰も参加しなければ破棄 |
| 全WebSocket切断後の猶予 | 45秒 | 一斉切断からの復帰待ち |
| Room TTL | 60分 | Roomの定期的な片付け上限 |

Roomの状態は基本的に `waiting → running → closed` です。

### 2.3 **絶対に維持するRoom作成制限**

Room作成制限は今回変更しません。Lobbyを追加しても、新しい抜け道や独立した緩和ルールを作ってはいけません。

現行の `worker/room-limit.js` と `POST /api/rooms` が持つ制限:

- 非管理者は、同一IPハッシュにつき同時に作成・保持できるRoomは1つ。
- 参加者がいたRoomが終了した場合、終了時点から2分のクールダウンを適用。
- まだ誰も参加していない `waiting` Roomは60秒で破棄し、現行実装ではクールダウンを開始しない。
- 管理用合言葉つきリクエストは従来どおり制限対象外。ただし管理用合言葉をブラウザの一般ユーザー向けコードへ埋め込まない。
- IPそのものではなく、現行どおりIPハッシュをD1の `room_limits` に保存する。
- 既存Roomへの参加はこの「新規Room作成枠」を消費せず、作成制限の対象にしない。

新規Roomを作るときは、必ず既存の `acquireSlot(env, ipHash, code, isAlive)` を通すこと。Lobby DOが直接Roomを初期化したり、別の経路でRoomを作成したりしてはいけません。

制限エラーは現行の意味を保ちます。

- `room_active`: 同じIP由来のRoomがまだ存在する。原則、同じRoom内の空き枠を利用する。
- `cooldown`: Room終了後のクールダウン中。レスポンスの `retryAfter` 秒をUIに表示する。
- `busy`: 作成枠の競合・一時的な失敗。時間をおいて再試行できるようにする。

同一IPを共有する家庭・学校・会社の利用者は作成枠も共有します。そのため、同じIPの別ユーザーも既存Roomに空きがあればそこへ参加し、満員で新規作成が必要な場合は現行制限に従って拒否される可能性があります。これは今回の機能で変更しません。

## 3. 新しい構成

### 3.1 GameLobby Durable Object

新たに `GameLobby` Durable Objectを導入します。**公開ワールド1件（`serverId`）につき1つ**を `idFromName(serverId)` で取得します。

GameLobbyの責務:

- 対象ワールドのRoom一覧を保持する。
- Roomごとの軽量な一覧情報を保持する。
- Roomの空き状況を確認し、参加先候補を選ぶ。
- 参加先の割当処理を直列化し、同じ空き枠に複数ユーザーを割り当てない。
- Roomから届く参加者数・表示名プレビュー・状態の更新を反映する。
- 閉鎖済み・長時間更新されないRoom情報を一覧から除去する。

GameLobbyが保持する情報は一覧用の小さなメタデータに限定します。

```js
{
  roomId: "ABC234",
  status: "waiting" | "running",
  players: 3,
  reserved: 1,
  maxPlayers: 8,
  playerPreview: [
    { name: "PlayerA" },
    { name: "PlayerB" }
  ],
  updatedAt: 1790000000000
}
```

- `playerPreview` は表示名の先頭4人程度に限定する。必要な場合でも公開情報は表示名と小さなアバター表示に限定し、再接続token、内部ID、接続情報は絶対に含めない。
- `players` は実際にWebSocket接続している人数、`reserved` は発行済みで未消費の参加枠数。
- 表示上の参加可能人数は `players + reserved < maxPlayers` で判定する。
- Roomの最新状態を保証できない古い一覧情報は参加先候補にしない。Room閉鎖通知と更新時刻による期限切れ処理を併用する。

### 3.2 Room Durable Object

既存の `Room` DOは引き続き1Roomを担当します。GameLobbyのために、次の機能を追加します。

- 参加者のjoin / leave / resumeに応じてGameLobbyへ軽量な状態更新を通知する。
- 予約枠の発行・有効期限・消費をRoom内で原子的に管理する。
- 実接続人数と有効な予約数を合わせて8人上限を守る。
- 予約ticketの重複使用・期限切れ・別Roomへの転用を拒否する。
- Room閉鎖時にGameLobbyへ閉鎖を通知する。

Lobby情報を更新するために、位置・向きなどの高頻度P2PパケットをRoomやGameLobbyに送ってはいけません。更新は入室・退出・予約・閉鎖などのイベント時だけにします。

### 3.3 Worker

Workerは公開APIと作成制限の唯一の入口です。

- GameLobbyとRoom DOを呼び出して一覧・割当・予約を調整する。
- 新規Roomが必要なときだけ、Workerが既存の `hashIp()` / `acquireSlot()` を使用して作成する。
- Roomの初期化に成功した後、GameLobbyへRoomを登録する。
- Room初期化に失敗した場合は現行どおり作成枠を解放する。
- 一般ブラウザから直接Lobby内部APIやRoom内部予約APIを操作できる公開ルートを作らない。

## 4. API案

以下は新機能用のAPI案です。実装時は既存WorkerのJSON形式・CORS・エラー処理に合わせてください。

### 4.1 Room一覧

`GET /api/servers/:serverId/rooms`

対象ワールドに属する参加可能Roomの一覧を返します。

レスポンス案:

```json
{
  "rooms": [
    {
      "roomId": "ABC234",
      "status": "running",
      "players": 3,
      "reserved": 0,
      "maxPlayers": 8,
      "playerPreview": [{ "name": "PlayerA" }, { "name": "PlayerB" }],
      "joinable": true,
      "updatedAt": 1790000000000
    }
  ]
}
```

満員・閉鎖・期限切れのRoomを参加可能一覧として返さないこと。画面を開いている間の更新は、最初は手動更新または短い間隔のpollingでよいものとし、WebSocketによるLobby購読は必要性を確認してから追加します。

### 4.2 自動参加・指定Room参加

`POST /api/servers/:serverId/join`

リクエスト案:

```json
{ "roomId": "ABC234" }
```

- `roomId` あり: 指定Roomへ参加枠を予約する。指定Roomが満員・閉鎖ならエラーを返し、別Roomや新規Roomへ勝手に切り替えない。
- `roomId` なし: GameLobbyが空きRoomを選ぶ。空きがなければWorkerが現行制限を通して新規Roomを作成する。
- 参加先決定後は短時間・一度限りのticketを発行する。

成功レスポンス案:

```json
{
  "roomId": "ABC234",
  "joinTicket": "short-lived-random-secret",
  "expiresAt": 1790000020000
}
```

作成制限エラーは現行の `room_active` / `cooldown` / `busy` と `retryAfter` を維持し、HTTP statusも現在のRoom作成APIとの整合性を取ります。

### 4.3 内部予約API（公開APIではない）

Room DO内に予約用の内部処理を追加します。例:

- `POST /reserve`: 空き枠を確認し、20〜30秒程度の短命ticketを発行。
- WebSocket接続: `/api/rooms/:code/ws?ticket=...` でticketを提示し、Roomが有効期限・Room一致・未使用を検証して消費する。

これは概念上の内部APIです。WorkerからDOのstubを通じて呼ぶだけにし、外部URLとして直接公開しないでください。ticketは十分な乱数を使い、必要ならRoom側にはticketのハッシュを保存します。使用成功時は必ず消費して再利用を防ぎます。

**ticketはワールドファイルのダウンロード完了後、WebSocket接続の直前に取得すること。** 先にticketを取得してから大きなワールドファイルをロードすると、有効期限切れで参加できなくなるためです。

## 5. 参加フロー

### 5.1 サーバー一覧から特定Roomを選ぶ場合

1. ユーザーがホームでワールドを選ぶ。
2. `GET /api/servers/:serverId/rooms` で一覧を表示。
3. ユーザーがRoomカードの「このサーバーに参加」を選ぶ。
4. GameViewでワールドを読み込み、準備完了後に `POST /api/servers/:serverId/join`（`roomId`あり）を呼ぶ。
5. WorkerがGameLobby経由で指定Roomを予約し、ticketを返す。
6. ブラウザがticketを使ってRoom WebSocketへ接続。Roomはticketを検証・消費し、通常のhello / peer-joinフローへ進む。
7. RoomからGameLobbyへ最新の人数・名簿プレビューを通知する。

一覧取得から参加確定までに他のユーザーが先に入る可能性があるため、一覧の `joinable` は参考情報です。最終的な枠確保は必ずRoom DO側で原子的に行います。指定Roomが満員になっていたら一覧を更新してユーザーに選び直してもらいます。

### 5.2 「空いているサーバーに参加」の場合

1. GameViewでワールド読み込みが終わった時点で `POST /api/servers/:serverId/join`（`roomId`なし）を呼ぶ。
2. GameLobbyが `players + reserved < maxPlayers` のRoomを選び、Room DOで予約を取る。
3. 選択候補が複数ある場合は、Room数の増加を抑えるため、**空き枠があるRoomのうち人数が多いものを優先**する。同数の場合は更新時刻などで決定的に選ぶ。
4. 既存Roomの予約に成功したらticketを返す。
5. 空きRoomがない場合だけ、新規作成処理へ進む。Workerが必ず現行の `acquireSlot()` を実行する。
6. `room_active` / `cooldown` なら作成せず、UIに待機理由を表示する。
7. 新規Roomを作成できた場合はGameLobbyへ登録してから、参加ticketを取得してWebSocket接続する。

同じワールドへの同時参加要求はGameLobbyで直列化し、同じRoomの残り1枠を複数人へ割り当てないこと。別ワールドへの同時作成競合などは、既存D1の原子的な `claimSlot()` が最後の防波堤になります。

### 5.3 予約ticketの失効・切断

- ticketの有効期限は20〜30秒程度を初期値とする。
- ticketを使わず期限切れになった場合は予約数を減らし、Lobbyへ最新値を通知する。
- ticketは1回だけ使用可能。
- 予約中にRoomが閉鎖した場合は参加を拒否し、一覧を更新する。
- WebSocket接続後は予約を実参加者へ置き換え、二重計上しない。
- 予約数が減るケース（期限切れ・接続失敗・Room閉鎖）を必ずテストする。
- Roomの既存Alarm（60秒未参加 / 45秒空室復帰猶予 / Room TTL）と予約expiryを共存させる。予約期限のためのAlarmでRoomの寿命や既存のクールダウン挙動を変えないこと。

## 6. UI・画面設計

### 6.1 画面遷移

既存の `ServersSection` のゲームカードクリックで、すぐに `GameView` を起動するのではなく、選択ワールドのサーバー一覧・詳細表示へ遷移する状態を追加します。

画面案:

- ワールド情報（名前・説明）
- サーバー一覧（Room ID、`players / 8`、表示名プレビュー、参加可能/満員）
- 各Roomの「このサーバーに参加」
- 目立つ「空いているサーバーに参加」
- 再読み込み
- Roomが0件の場合の説明と自動参加ボタン
- 作成制限中・Worker未設定・ネットワークエラーの説明

参加人数は実人数として表示し、予約中の枠は必要なら「接続処理中」を示すなど、実人数と予約枠を混同させないこと。

### 6.2 表示ルール

- Roomカードは `3 / 8` の形式で表示する。
- 参加者プレビューは最大4人程度。残りは `+N` と表示する。
- 表示名は既存Roomの `cleanName()` と同様にサニタイズする。
- 満員・閉鎖Roomは参加ボタンを無効化する。
- 一覧上で空きがあっても、クリック時の予約が失敗する可能性を考慮し、エラー後に再取得できるようにする。
- Roomが0件の場合の自動作成は、現行のRoom作成制限を満たしたときだけ行う。制限中に別経路でRoomを作ってはならない。

## 7. 実装順序（小さく段階的にコミット）

次の順序を推奨します。各段階のテストを追加してから次へ進みます。

### Phase A: Room予約機構

- [ ] Room DOに予約枠・ticket・expiryを追加。
- [ ] 実人数と有効予約数の合計で8人上限を保護。
- [ ] WS接続時にticketを検証して一度だけ消費。
- [ ] 参加者join / leave / resume / 予約expiryをLobby通知へ接続できるイベント関数に整理。
- [ ] 既存のRoom参加・再接続・シグナリングの挙動を壊さない。

### Phase B: GameLobby DO

- [ ] `GameLobby` classを追加し、`serverId` ごとにRoomメタデータを管理。
- [ ] Room登録・更新・削除の内部メッセージを実装。
- [ ] 一覧取得と空きRoom候補選択を実装。
- [ ] 同一GameLobby内の参加割当を直列化。
- [ ] 古い一覧データ・閉鎖Roomのcleanupを実装。
- [ ] `worker/wrangler.toml` にbindingと新migrationを追加。

### Phase C: Worker API・作成制限統合

- [ ] `GET /api/servers/:id/rooms` を追加。
- [ ] `POST /api/servers/:id/join` を追加。
- [ ] 指定Room参加と自動参加を分岐。
- [ ] 自動参加時は既存Roomの予約を先に試す。
- [ ] 新規Room作成は既存 `acquireSlot()` を必ず通す。
- [ ] Room初期化失敗時の `releaseSlot()` とLobby登録失敗時の後始末を確認。
- [ ] 既存 `POST /api/rooms` の制限・互換性を確認し、不要になる場合でも別途判断なく削除しない。

### Phase D: フロントエンド

- [ ] ゲーム選択後にRoom一覧を表示。
- [ ] Roomカード、人数、参加者プレビュー、満員状態を実装。
- [ ] 特定Room参加と「空いているサーバーに参加」を実装。
- [ ] GameViewのワールド読込完了後にjoin APIを呼び、ticketで接続。
- [ ] 通常UIからのRoom ID手入力を不要にする。開発・デバッグ用途の手入力を残す場合は通常導線から分離。
- [ ] `room_active` / `cooldown` / `busy` / `room_full` / `room_closed` の日本語表示を実装。

### Phase E: 検証・ドキュメント

- [ ] Worker / Room DO / GameLobby DOのユニットテストを追加。
- [ ] フロントエンドの参加状態・エラー表示を確認。
- [ ] 複数ブラウザで実際の同時参加・満員・退出・再接続を確認。
- [ ] `npm test` と `npm run build` を実行。
- [ ] Workerのmigration・D1・Durable Object bindingをデプロイ環境で確認。
- [ ] 実装とこの文書、READMEのAPI表を一致させる。

## 8. 必須テスト観点

### Room予約・上限

- 実人数7人 + 予約0件なら1件だけ予約可能。
- 実人数7人 + 予約1件なら次の予約を拒否。
- 同時に2人が最後の1枠を予約しようとしても、成功は片方だけ。
- ticketは期限切れ・別Room・二重使用で拒否。
- ticket接続成功後、予約数は減り実人数が1増える（合計枠は変わらない）。
- 予約失効後は枠が再び利用可能。
- 退出後の人数とプレビューが正しくLobbyへ反映される。

### Lobby・一覧

- 異なる `serverId` のRoomが混在しない。
- Room追加・更新・閉鎖が一覧に反映される。
- stale / closed Roomが参加先として返らない。
- 自動参加は利用可能なRoomを優先し、新規作成を不必要に増やさない。
- 同じワールドで同時join要求が来ても、8人上限を超えない。
- 特定Roomを指定した要求は、満員時に別Roomへ勝手に切り替わらない。

### 作成制限（最重要）

- 既存Roomに入る処理は `acquireSlot()` を呼ばない。
- 既存Roomが全て満員で、新規作成が必要な場合は必ず `acquireSlot()` を通る。
- 同一IPから同時に新規作成できるRoomは従来どおり1つ。
- Room終了後の2分クールダウンが従来どおり適用される。
- 未参加waiting Roomの60秒破棄時は、従来どおりクールダウンを開始しない。
- 管理用合言葉の扱いを変更しない。ブラウザへ秘密を露出しない。
- Lobby経由と既存 `POST /api/rooms` の両方から制限を迂回できない。

### 既存P2P回帰

- Roomのhello / peer-join / peer-back / peer-leave。
- SDP / ICEシグナリング。
- ctl / st DataChannelと状態同期。
- Room WebSocket切断後も成立済みP2Pを維持すること。
- 時計同期、Room再接続、退出処理。

## 9. 実装時の注意・非目標

- GameLobbyはRoom発見と参加先割当だけを担当する。プレイヤー状態パケットやゲーム進行データを中継しない。
- 新機能を理由にRoomの最大人数8人や現在の作成制限を緩和しない。
- 今回はAuthority選出・Authority引き継ぎ・ゲーム状態の権威同期を実装しない。
- TURNサーバー導入やP2Pトポロジー変更は別タスク。
- 参加者プレビューのためだけにRoomへ定期的な高頻度アクセスを行わない。
- Lobby情報はキャッシュであり、最終的な入室可否はRoom DOが判断する。
- CloudflareのDurable Object migrationは既存migrationを編集せず、新しいtagを追加する。
- テストを追加しただけで動作確認済みとは記載しない。実機確認とCI結果は別々に記録する。

## 10. 完了条件

- ワールドを選ぶと、そのワールドのRoom一覧が見える。
- Room ID・人数・参加者プレビューが表示される。
- Room IDを入力せず、選択したRoomへ参加できる。
- 「空いているサーバーに参加」で既存Roomを優先して利用できる。
- Roomが0件、または全Room満員なら、現行作成制限を満たす場合だけ新規Roomが作られる。
- 作成制限中は理由と再試行可能時間を表示し、制限を迂回しない。
- Room人数は実接続と予約を含めても8人を超えない。
- P2Pの既存同期・再接続・時計同期が回帰していない。

-- D1: サーバー(rbxl)の一覧。ファイル本体はR2に置き、ここには情報だけを入れる
CREATE TABLE IF NOT EXISTS servers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  format      TEXT NOT NULL,          -- 'rbxl' | 'rbxlx' | 'tgw'
  size        INTEGER NOT NULL,       -- バイト数
  r2_key      TEXT NOT NULL UNIQUE,   -- R2上のキー(servers/<id>.<format>)
  created_at  TEXT NOT NULL           -- ISO 8601
);
CREATE INDEX IF NOT EXISTS idx_servers_created ON servers (created_at DESC);

-- マルチプレイ: ルーム作成の回数制限。IPはハッシュだけ保存する(同時1ルーム + 終了後のクールダウン)
CREATE TABLE IF NOT EXISTS room_limits (
  ip_hash        TEXT PRIMARY KEY,
  active_room    TEXT,                       -- いま作っているルームのコード。無ければ NULL
  last_closed_at INTEGER NOT NULL DEFAULT 0  -- 最後にルームが終わった時刻(ミリ秒)
);

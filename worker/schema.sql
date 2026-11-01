-- D1: サーバー(rbxl)の一覧。ファイル本体はR2に置き、ここには情報だけを入れる
CREATE TABLE IF NOT EXISTS servers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  format      TEXT NOT NULL,          -- 'rbxl' | 'rbxlx'
  size        INTEGER NOT NULL,       -- バイト数
  r2_key      TEXT NOT NULL UNIQUE,   -- R2上のキー(servers/<id>.<format>)
  created_at  TEXT NOT NULL           -- ISO 8601
);
CREATE INDEX IF NOT EXISTS idx_servers_created ON servers (created_at DESC);

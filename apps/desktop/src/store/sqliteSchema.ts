/**
 * SQLite 表结构（桌面端正式存储）。
 *
 * 桌面版在首次访问存储时执行本 DDL（`IF NOT EXISTS`，可重复执行），
 * 之后的读写都走 `sqliteStore.ts` 的参数化 SQL。
 *
 * 字段与需求文档第 8.1 节一致。
 */
export const SQLITE_SCHEMA = `
-- 听力档案（多份，可切换）
CREATE TABLE IF NOT EXISTS profiles (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  left_config   TEXT,
  right_config  TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- 测听会话
CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  ear          TEXT NOT NULL CHECK (ear IN ('LEFT','RIGHT')),
  device_note  TEXT,
  results      TEXT NOT NULL,
  started_at   TEXT NOT NULL,
  finished_at  TEXT
);

-- 处理任务（字幕 / 增强，v0.2 起使用）
CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  input_path  TEXT NOT NULL,
  output_path TEXT,
  status      TEXT NOT NULL,
  progress    INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  created_at  TEXT NOT NULL
);

-- 设置与同意状态
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS consents (version TEXT PRIMARY KEY, accepted_at TEXT, revoked_at TEXT);

-- 同步状态（v0.4 联机时使用）
CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

/**
 * 桌面端实现：数据存 SQLite（`%APPDATA%\HearLink\hearlink.db`）。
 *
 * 通过 Tauri 命令执行**参数化** SQL（`sqlite_batch` / `sqlite_execute` / `sqlite_query`），
 * 表结构见 `sqliteSchema.ts`（单一真源，启动时执行一次建表）。
 *
 * 首次使用且库里没有数据时，会把浏览器预览留在 localStorage 的数据迁移进来，
 * 并保留 localStorage 原数据作为备份（不删除）。
 */
import { invoke } from '@tauri-apps/api/core';
import type { Ear, HearingResult } from '@hearlink/domain';
import { SQLITE_SCHEMA } from './sqliteSchema';
import type { LocalStore, ProfileRecord, SessionRecord } from './types';

type SqlParam = string | number | null;

const ACTIVE_PROFILE_KEY = 'activeProfileId';

const INSERT_SETTING = `INSERT INTO settings (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value`;

async function batch(sql: string): Promise<void> {
  await invoke('sqlite_batch', { sql });
}

async function execute(sql: string, params: SqlParam[] = []): Promise<number> {
  return invoke<number>('sqlite_execute', { sql, params });
}

async function query<T>(sql: string, params: SqlParam[] = []): Promise<T[]> {
  return invoke<T[]>('sqlite_query', { sql, params });
}

interface ProfileRow {
  id: string;
  name: string;
  left_config: string | null;
  right_config: string | null;
  created_at: string;
  updated_at: string;
}

interface SessionRow {
  id: string;
  ear: string;
  device_note: string | null;
  results: string;
  started_at: string;
  finished_at: string | null;
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function toProfile(row: ProfileRow): ProfileRecord {
  return {
    id: row.id,
    name: row.name,
    left: parseJson<ProfileRecord['left']>(row.left_config),
    right: parseJson<ProfileRecord['right']>(row.right_config),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    ear: row.ear as Ear,
    results: parseJson<HearingResult[]>(row.results) ?? [],
    deviceNote: row.device_note,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function now(): string {
  return new Date().toISOString();
}

/** 从浏览器预览的 localStorage 迁移一次（只在库为空时）。 */
async function migrateFromBrowserStorage(): Promise<void> {
  const rawProfiles = window.localStorage.getItem('hearlink.profiles');
  const rawSessions = window.localStorage.getItem('hearlink.sessions');
  if (!rawProfiles && !rawSessions) return;

  const profiles = parseJson<ProfileRecord[]>(rawProfiles) ?? [];
  const sessions = parseJson<SessionRecord[]>(rawSessions) ?? [];
  if (profiles.length === 0 && sessions.length === 0) return;

  const existing = await query<{ c: number }>('SELECT COUNT(*) AS c FROM profiles');
  if (Number(existing[0]?.c ?? 0) > 0) return;

  for (const profile of profiles) {
    await execute(
      `INSERT OR IGNORE INTO profiles (id, name, left_config, right_config, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        profile.id,
        profile.name,
        profile.left ? JSON.stringify(profile.left) : null,
        profile.right ? JSON.stringify(profile.right) : null,
        profile.createdAt,
        profile.updatedAt,
      ],
    );
  }

  for (const session of sessions) {
    await execute(
      `INSERT OR IGNORE INTO sessions (id, ear, device_note, results, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        session.id,
        session.ear,
        session.deviceNote,
        JSON.stringify(session.results ?? []),
        session.startedAt,
        session.finishedAt,
      ],
    );
  }

  const activeId = window.localStorage.getItem('hearlink.activeProfileId');
  if (activeId) await execute(INSERT_SETTING, [ACTIVE_PROFILE_KEY, activeId]);

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key || !key.startsWith('hearlink.setting.')) continue;
    const value = window.localStorage.getItem(key);
    if (value !== null) {
      await execute(INSERT_SETTING, [key.slice('hearlink.setting.'.length), value]);
    }
  }

  console.info(`[store] 已从浏览器预览迁移 ${profiles.length} 份档案、${sessions.length} 条测听记录到 SQLite`);
}

let ready: Promise<void> | null = null;

function ensureReady(): Promise<void> {
  ready ??= (async () => {
    await batch(SQLITE_SCHEMA);
    await migrateFromBrowserStorage();
  })();
  return ready;
}

// ---------------------------------------------------------------- 档案

async function listProfiles(): Promise<ProfileRecord[]> {
  await ensureReady();
  const rows = await query<ProfileRow>('SELECT * FROM profiles ORDER BY updated_at DESC');
  return rows.map(toProfile);
}

async function getProfile(id: string): Promise<ProfileRecord | null> {
  await ensureReady();
  const rows = await query<ProfileRow>('SELECT * FROM profiles WHERE id = ?', [id]);
  return rows[0] ? toProfile(rows[0]) : null;
}

async function getActiveProfile(): Promise<ProfileRecord | null> {
  await ensureReady();
  const active = await query<{ value: string }>('SELECT value FROM settings WHERE key = ?', [
    ACTIVE_PROFILE_KEY,
  ]);
  if (active[0]?.value) {
    const found = await getProfile(active[0].value);
    if (found) return found;
  }
  const rows = await query<ProfileRow>('SELECT * FROM profiles ORDER BY updated_at DESC LIMIT 1');
  return rows[0] ? toProfile(rows[0]) : null;
}

async function setActiveProfile(id: string | null): Promise<void> {
  await ensureReady();
  if (id) {
    await execute(INSERT_SETTING, [ACTIVE_PROFILE_KEY, id]);
  } else {
    await execute('DELETE FROM settings WHERE key = ?', [ACTIVE_PROFILE_KEY]);
  }
}

async function saveProfile(profile: ProfileRecord): Promise<void> {
  await ensureReady();
  await execute(
    `INSERT INTO profiles (id, name, left_config, right_config, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       left_config = excluded.left_config,
       right_config = excluded.right_config,
       updated_at = excluded.updated_at`,
    [
      profile.id,
      profile.name,
      profile.left ? JSON.stringify(profile.left) : null,
      profile.right ? JSON.stringify(profile.right) : null,
      profile.createdAt,
      profile.updatedAt,
    ],
  );

  const active = await query<{ value: string }>('SELECT value FROM settings WHERE key = ?', [
    ACTIVE_PROFILE_KEY,
  ]);
  if (!active[0]?.value) await setActiveProfile(profile.id);
}

async function deleteProfile(id: string): Promise<void> {
  await ensureReady();
  await execute('DELETE FROM profiles WHERE id = ?', [id]);
  const active = await query<{ value: string }>('SELECT value FROM settings WHERE key = ?', [
    ACTIVE_PROFILE_KEY,
  ]);
  if (active[0]?.value === id) await setActiveProfile(null);
}

// ---------------------------------------------------------------- 测听会话

async function createSession(ear: Ear, deviceNote?: string | null): Promise<SessionRecord> {
  await ensureReady();
  const session: SessionRecord = {
    id: crypto.randomUUID(),
    ear,
    results: [],
    deviceNote: deviceNote ?? null,
    startedAt: now(),
    finishedAt: null,
  };
  await execute(
    `INSERT INTO sessions (id, ear, device_note, results, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [session.id, session.ear, session.deviceNote, '[]', session.startedAt, session.finishedAt],
  );
  return session;
}

async function saveResults(sessionId: string, results: HearingResult[]): Promise<void> {
  await ensureReady();
  await execute('UPDATE sessions SET results = ? WHERE id = ?', [
    JSON.stringify(results),
    sessionId,
  ]);
}

async function completeSession(sessionId: string): Promise<void> {
  await ensureReady();
  await execute('UPDATE sessions SET finished_at = ? WHERE id = ?', [now(), sessionId]);
}

async function listSessions(): Promise<SessionRecord[]> {
  await ensureReady();
  const rows = await query<SessionRow>('SELECT * FROM sessions ORDER BY started_at DESC');
  return rows.map(toSession);
}

// ---------------------------------------------------------------- 导出 / 清理

async function exportAll(): Promise<string> {
  await ensureReady();
  const [profiles, sessions, active] = await Promise.all([
    listProfiles(),
    listSessions(),
    query<{ value: string }>('SELECT value FROM settings WHERE key = ?', [ACTIVE_PROFILE_KEY]),
  ]);
  return JSON.stringify(
    {
      exportedAt: now(),
      profiles,
      activeProfileId: active[0]?.value ?? null,
      sessions,
    },
    null,
    2,
  );
}

async function clearAll(): Promise<void> {
  await ensureReady();
  await execute('DELETE FROM profiles');
  await execute('DELETE FROM sessions');
  await execute('DELETE FROM settings WHERE key = ?', [ACTIVE_PROFILE_KEY]);
}

async function clearSessions(): Promise<void> {
  await ensureReady();
  await execute('DELETE FROM sessions');
}

// ---------------------------------------------------------------- 设置

async function getSetting(key: string): Promise<string | null> {
  await ensureReady();
  const rows = await query<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  return rows[0]?.value ?? null;
}

async function setSetting(key: string, value: string | null): Promise<void> {
  await ensureReady();
  if (value === null) {
    await execute('DELETE FROM settings WHERE key = ?', [key]);
  } else {
    await execute(INSERT_SETTING, [key, value]);
  }
}

export function createSqliteStore(): LocalStore {
  return {
    listProfiles,
    getProfile,
    getActiveProfile,
    setActiveProfile,
    saveProfile,
    deleteProfile,
    createSession,
    saveResults,
    completeSession,
    listSessions,
    exportAll,
    clearAll,
    clearSessions,
    getSetting,
    setSetting,
  };
}

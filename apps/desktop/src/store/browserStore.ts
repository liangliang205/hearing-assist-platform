import type { Ear, HearingResult } from '@hearlink/domain';
import type { LocalStore, ProfileRecord, SessionRecord } from './types';

/**
 * 浏览器预览实现：数据存 localStorage。
 *
 * 仅用于开发期在浏览器里预览界面与流程（见需求文档「开发阶段采用本地浏览器预览」）。
 * 正式桌面端会换成 SQLite（表结构见 `sqliteSchema.ts`），接口保持不变。
 */

const KEY_PROFILES = 'hearlink.profiles';
const KEY_ACTIVE = 'hearlink.activeProfileId';
const KEY_SESSIONS = 'hearlink.sessions';
const KEY_SETTING_PREFIX = 'hearlink.setting.';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function newId(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

export function createBrowserStore(): LocalStore {
  return {
    async listProfiles() {
      return readJson<ProfileRecord[]>(KEY_PROFILES, []).sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      );
    },

    async getProfile(id) {
      return readJson<ProfileRecord[]>(KEY_PROFILES, []).find((item) => item.id === id) ?? null;
    },

    async getActiveProfile() {
      const profiles = readJson<ProfileRecord[]>(KEY_PROFILES, []);
      const activeId = window.localStorage.getItem(KEY_ACTIVE);

      if (activeId) {
        const found = profiles.find((item) => item.id === activeId);
        if (found) return found;
      }
      // 没有显式指定时，取最近更新的一份
      return profiles.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
    },

    async setActiveProfile(id) {
      if (id) {
        window.localStorage.setItem(KEY_ACTIVE, id);
      } else {
        window.localStorage.removeItem(KEY_ACTIVE);
      }
    },

    async saveProfile(profile) {
      const profiles = readJson<ProfileRecord[]>(KEY_PROFILES, []);
      const exists = profiles.some((item) => item.id === profile.id);
      const next = exists
        ? profiles.map((item) => (item.id === profile.id ? profile : item))
        : [...profiles, profile];
      writeJson(KEY_PROFILES, next);

      if (!window.localStorage.getItem(KEY_ACTIVE)) {
        window.localStorage.setItem(KEY_ACTIVE, profile.id);
      }
    },

    async deleteProfile(id) {
      const profiles = readJson<ProfileRecord[]>(KEY_PROFILES, []).filter((item) => item.id !== id);
      writeJson(KEY_PROFILES, profiles);
      if (window.localStorage.getItem(KEY_ACTIVE) === id) {
        window.localStorage.removeItem(KEY_ACTIVE);
      }
    },

    async createSession(ear: Ear, deviceNote?: string | null) {
      const session: SessionRecord = {
        id: newId(),
        ear,
        results: [],
        deviceNote: deviceNote ?? null,
        startedAt: now(),
        finishedAt: null,
      };
      const sessions = readJson<SessionRecord[]>(KEY_SESSIONS, []);
      writeJson(KEY_SESSIONS, [...sessions, session]);
      return session;
    },

    async saveResults(sessionId, results: HearingResult[]) {
      const sessions = readJson<SessionRecord[]>(KEY_SESSIONS, []).map((item) =>
        item.id === sessionId ? { ...item, results } : item,
      );
      writeJson(KEY_SESSIONS, sessions);
    },

    async completeSession(sessionId) {
      const sessions = readJson<SessionRecord[]>(KEY_SESSIONS, []).map((item) =>
        item.id === sessionId ? { ...item, finishedAt: now() } : item,
      );
      writeJson(KEY_SESSIONS, sessions);
    },

    async listSessions() {
      return readJson<SessionRecord[]>(KEY_SESSIONS, []).sort((a, b) =>
        b.startedAt.localeCompare(a.startedAt),
      );
    },

    async exportAll() {
      return JSON.stringify(
        {
          exportedAt: now(),
          profiles: readJson<ProfileRecord[]>(KEY_PROFILES, []),
          activeProfileId: window.localStorage.getItem(KEY_ACTIVE),
          sessions: readJson<SessionRecord[]>(KEY_SESSIONS, []),
        },
        null,
        2,
      );
    },

    async clearAll() {
      window.localStorage.removeItem(KEY_PROFILES);
      window.localStorage.removeItem(KEY_ACTIVE);
      window.localStorage.removeItem(KEY_SESSIONS);
    },

    async clearSessions() {
      window.localStorage.removeItem(KEY_SESSIONS);
    },

    async getSetting(key) {
      return window.localStorage.getItem(KEY_SETTING_PREFIX + key);
    },

    async setSetting(key, value) {
      if (value === null) {
        window.localStorage.removeItem(KEY_SETTING_PREFIX + key);
      } else {
        window.localStorage.setItem(KEY_SETTING_PREFIX + key, value);
      }
    },
  };
}

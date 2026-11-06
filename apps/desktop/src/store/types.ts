import type { Ear, EarCompensation, HearingResult } from '@hearlink/domain';

/** 一份听力档案：左右耳各一份补偿参数，可有多份档案切换。 */
export interface ProfileRecord {
  id: string;
  name: string;
  left: EarCompensation | null;
  right: EarCompensation | null;
  createdAt: string;
  updatedAt: string;
}

/** 一次单耳测听会话。 */
export interface SessionRecord {
  id: string;
  ear: Ear;
  results: HearingResult[];
  deviceNote: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/**
 * 本地存储抽象。
 *
 * 当前实现：浏览器预览用 localStorage（开发期）。
 * 桌面端接入 Tauri 后替换为 SQLite 实现，接口不变，页面无需改动。
 */
export interface LocalStore {
  listProfiles(): Promise<ProfileRecord[]>;
  getProfile(id: string): Promise<ProfileRecord | null>;
  getActiveProfile(): Promise<ProfileRecord | null>;
  setActiveProfile(id: string | null): Promise<void>;
  saveProfile(profile: ProfileRecord): Promise<void>;
  deleteProfile(id: string): Promise<void>;

  createSession(ear: Ear, deviceNote?: string | null): Promise<SessionRecord>;
  saveResults(sessionId: string, results: HearingResult[]): Promise<void>;
  completeSession(sessionId: string): Promise<void>;
  listSessions(): Promise<SessionRecord[]>;

  /** 导出全部本地数据（JSON 字符串），用于备份与迁移。 */
  exportAll(): Promise<string>;
  /** 清空全部本地数据。 */
  clearAll(): Promise<void>;
  /** 仅清空测听记录，保留档案。 */
  clearSessions(): Promise<void>;

  /** 读取本地设置（如音量校准系数）。 */
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string | null): Promise<void>;
}

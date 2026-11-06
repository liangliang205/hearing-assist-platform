import { isDesktopShell } from '../desktop/systemEngine';
import { createBrowserStore } from './browserStore';
import { createSqliteStore } from './sqliteStore';

export type { LocalStore, ProfileRecord, SessionRecord } from './types';
export { SQLITE_SCHEMA } from './sqliteSchema';

/**
 * 全局本地存储实例。
 *
 * - 桌面版（Tauri）：SQLite，文件在 `%APPDATA%\HearLink\hearlink.db`；
 * - 浏览器预览：localStorage（开发期看界面用）。
 *
 * 两者实现同一个 `LocalStore` 接口，页面代码不需要区分。
 */
export const localStore = isDesktopShell() ? createSqliteStore() : createBrowserStore();

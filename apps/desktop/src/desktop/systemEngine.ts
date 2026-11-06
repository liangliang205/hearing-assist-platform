/**
 * 桌面端（Tauri）系统级增强桥接。
 *
 * 浏览器预览里 `isDesktopShell()` 为 false，界面上不会出现开关，
 * 动态 import 也保证 Tauri API 不会进入 Web 构建的运行时。
 */
import { useCallback, useEffect, useState } from 'react';
import type { CompensationConfig } from '@hearlink/domain';

export interface EngineStatus {
  running: boolean;
  pid: number | null;
  profilePath: string;
  logPath: string;
}

/** 是否跑在 Tauri 外壳里（浏览器直接打开时为 false）。 */
export function isDesktopShell(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

export async function readEngineStatus(): Promise<EngineStatus> {
  return call<EngineStatus>('system_engine_status');
}

/**
 * 订阅引擎状态：桌面壳里每 2 秒问一次，浏览器里保持 null。
 * 返回 setStatus 是为了开关操作后立刻刷新，不用等下一轮轮询。
 */
export function useEngineStatus(): {
  status: EngineStatus | null;
  setStatus: (status: EngineStatus | null) => void;
  refresh: () => Promise<void>;
} {
  const enabled = isDesktopShell();
  const [status, setStatus] = useState<EngineStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await readEngineStatus());
    } catch {
      // 外壳刚启动时命令可能还没注册，忽略即可
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, [enabled, refresh]);

  return { status, setStatus, refresh };
}

/** 把当前补偿配置写到 %APPDATA%\HearLink\profile.json（引擎会热加载）。 */
export async function writeProfile(config: CompensationConfig): Promise<string> {
  return call<string>('system_profile_write', { profileJson: JSON.stringify(config) });
}

export async function startEngine(config: CompensationConfig): Promise<EngineStatus> {
  return call<EngineStatus>('system_engine_start', { profileJson: JSON.stringify(config) });
}

export async function stopEngine(): Promise<EngineStatus> {
  return call<EngineStatus>('system_engine_stop');
}

export function engineErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return '系统级增强操作失败';
}

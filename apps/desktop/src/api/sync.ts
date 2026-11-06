import { EARS, planEarMerge, type Ear, type EarCompensation } from '@hearlink/domain';
import { ApiError } from './client';
import { profileApi, type RemoteProfilePayload } from './profile';
import { localStore } from '../store';
import { applyEar, emptyProfile } from '../store/profile';
import type { ProfileRecord } from '../store/types';

/**
 * 自动同步：登录后双向合并，之后每次本机写入静默上传，全程不需要按钮。
 *
 * - 游客模式（未登录）完全不走网络；
 * - 合并按耳的 `generatedAt` 比较：云端更新就导入，本地更新就上传，
 *   既做到「登录即导入」，又不会覆盖本机更新的数据；
 * - 用档案 `updatedAt` 做幂等标记，同一份档案不重复上传；
 * - 并发调用复用同一次请求；失败静默降级，下个触发点自动重试。
 */

const KEY_LAST_SYNCED_PREFIX = 'sync.lastProfileUpdatedAt.';

let syncEnabled = false;
let syncUserId: string | null = null;
let inFlight: Promise<SyncOutcome> | null = null;
/** 已知云端没有该用户的档案（登录后首次 GET 404），避免每分钟重复探测。 */
let cloudProfileMissing = false;

export type SyncReason = 'synced' | 'disabled' | 'no-profile' | 'up-to-date' | 'offline';

export interface SyncOutcome {
  reason: SyncReason;
  pushed: number;
}

export interface MergeResult {
  pulled: number;
  pushed: number;
}

/**
 * 由登录状态驱动；游客模式下所有同步调用直接短路。
 * `userId` 用于隔离「上次同步标记」——不同账号各自独立，
 * 否则 A 同步过之后登录 B 会被误判成「已是最新」而跳过上传。
 */
export function setSyncEnabled(value: boolean, userId?: string | null): void {
  syncEnabled = value;
  syncUserId = value ? (userId ?? null) : null;
  cloudProfileMissing = false;
}

function lastSyncedKey(): string {
  return `${KEY_LAST_SYNCED_PREFIX}${syncUserId ?? 'anonymous'}`;
}

function earCompensation(profile: ProfileRecord, ear: Ear): EarCompensation | null {
  return ear === 'LEFT' ? profile.left : profile.right;
}

/** 仅上传本机改动（写入后立即调用，速度快）。 */
export function autoSync(profile?: ProfileRecord | null): Promise<SyncOutcome> {
  if (!syncEnabled) return Promise.resolve({ reason: 'disabled', pushed: 0 });
  if (inFlight) return inFlight;

  inFlight = runAutoSync(profile).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runAutoSync(profile?: ProfileRecord | null): Promise<SyncOutcome> {
  const current = profile ?? (await localStore.getActiveProfile());
  if (!current) return { reason: 'no-profile', pushed: 0 };

  const last = await localStore.getSetting(lastSyncedKey());
  if (last === current.updatedAt) return { reason: 'up-to-date', pushed: 0 };

  const ears = EARS.filter((ear) => Boolean(earCompensation(current, ear)));
  if (ears.length === 0) return { reason: 'no-profile', pushed: 0 };

  try {
    for (const ear of ears) {
      const compensation = earCompensation(current, ear);
      if (compensation) await profileApi.pushEar(ear, compensation);
    }
  } catch {
    return { reason: 'offline', pushed: 0 };
  }

  await localStore.setSetting(lastSyncedKey(), current.updatedAt);
  return { reason: 'synced', pushed: ears.length };
}

/**
 * 双向合并：登录后立即执行，窗口聚焦与定时兜底时也会执行。
 * 云端更新 → 导入本机；本地更新 → 上传云端。
 */
export async function mergeWithCloud(): Promise<MergeResult> {
  if (!syncEnabled) return { pulled: 0, pushed: 0 };

  const current = (await localStore.getActiveProfile()) ?? emptyProfile();
  const localHasData = Boolean(current.left || current.right);

  // 本机也没数据、且已知云端为空时，不必每分钟再探一次
  let remote: RemoteProfilePayload | null = null;
  if (!(cloudProfileMissing && !localHasData)) {
    try {
      remote = await profileApi.get();
      cloudProfileMissing = false;
    } catch (error) {
      // 云端还没有档案属于正常情况；网络/鉴权问题静默跳过本轮
      if (!(error instanceof ApiError)) return { pulled: 0, pushed: 0 };
      if (!error.isNotFound) return { pulled: 0, pushed: 0 };
      cloudProfileMissing = true;
    }
  }

  const localMap = { LEFT: current.left, RIGHT: current.right };
  const cloudMap = {
    LEFT: remote?.profiles?.LEFT?.config ?? null,
    RIGHT: remote?.profiles?.RIGHT?.config ?? null,
  };

  const { pull, push } = planEarMerge(localMap, cloudMap);

  let updated = current;
  for (const ear of pull) {
    const compensation = cloudMap[ear];
    if (compensation) updated = applyEar(updated, ear, compensation);
  }

  if (pull.length > 0) await localStore.saveProfile(updated);

  for (const ear of push) {
    const compensation = ear === 'LEFT' ? updated.left : updated.right;
    if (compensation) await profileApi.pushEar(ear, compensation);
  }

  if (push.length > 0) cloudProfileMissing = false;

  if (pull.length > 0 || push.length > 0) {
    await localStore.setSetting(lastSyncedKey(), updated.updatedAt);
  }

  return { pulled: pull.length, pushed: push.length };
}

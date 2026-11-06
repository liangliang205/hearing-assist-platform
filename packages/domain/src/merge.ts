import { EARS, type Ear, type EarCompensation } from './audiogram';

/**
 * 双耳合并策略：决定每个频带以哪一边为准。
 *
 * 规则（按耳的 `generatedAt` 比较）：
 * - 只有云端有 → 拉取
 * - 只有本机有 → 上传
 * - 两边都有，云端更新 → 拉取；否则（含时间相同/无法解析）→ 上传
 *
 * 之所以不是「登录就用云端覆盖本机」：本机可能刚测完还没同步，
 * 直接覆盖会把新数据冲掉。
 */
export interface MergePlan {
  /** 需要从云端导入本机的耳别。 */
  pull: Ear[];
  /** 需要从本机上传云端的耳别。 */
  push: Ear[];
}

/** 只有两边都是可解析时间且云端更新时才算「云端更新」。 */
function isCloudNewer(cloud: string, local: string): boolean {
  const cloudTime = Date.parse(cloud);
  const localTime = Date.parse(local);
  if (Number.isNaN(cloudTime) || Number.isNaN(localTime)) return false;
  return cloudTime > localTime;
}

export function planEarMerge(
  local: Partial<Record<Ear, EarCompensation | null>>,
  cloud: Partial<Record<Ear, EarCompensation | null>>,
): MergePlan {
  const pull: Ear[] = [];
  const push: Ear[] = [];

  for (const ear of EARS) {
    const localCompensation = local[ear] ?? null;
    const cloudCompensation = cloud[ear] ?? null;

    if (!cloudCompensation) {
      if (localCompensation) push.push(ear);
      continue;
    }

    if (!localCompensation) {
      pull.push(ear);
      continue;
    }

    if (isCloudNewer(cloudCompensation.generatedAt, localCompensation.generatedAt)) {
      pull.push(ear);
    } else {
      push.push(ear);
    }
  }

  return { pull, push };
}

import {
  buildBinauralConfig,
  type CompensationConfig,
  type Ear,
  type EarCompensation,
} from '@hearlink/domain';
import type { ProfileRecord } from './types';

/** 由一份档案生成双耳合计配置（与 Web 版同源）。 */
export function configFromProfile(profile: ProfileRecord | null): CompensationConfig | null {
  if (!profile) return null;
  return buildBinauralConfig({ LEFT: profile.left, RIGHT: profile.right });
}

export function emptyProfile(name = '默认档案'): ProfileRecord {
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    left: null,
    right: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/** 把一次测听的结果并入档案（不修改入参）。 */
export function applyEar(
  profile: ProfileRecord | null,
  ear: Ear,
  compensation: EarCompensation,
): ProfileRecord {
  const base = profile ?? emptyProfile();
  return {
    ...base,
    left: ear === 'LEFT' ? compensation : base.left,
    right: ear === 'RIGHT' ? compensation : base.right,
    updatedAt: new Date().toISOString(),
  };
}

export function profileSummary(profile: ProfileRecord | null): string {
  if (!profile) return '尚未测听';
  const parts: string[] = [];
  if (profile.left) parts.push(`左耳 ${profile.left.ptaDbHl ?? '--'} dB`);
  if (profile.right) parts.push(`右耳 ${profile.right.ptaDbHl ?? '--'} dB`);
  return parts.length > 0 ? parts.join(' · ') : '尚未测听';
}

import type { HearingProfile } from '@prisma/client';
import {
  buildBinauralConfig,
  EARS,
  type CompensationConfig,
  type Ear,
  type EarCompensation,
} from './audiogram';
import { prisma } from './prisma';

export type EarCompensationMap = Record<Ear, EarCompensation | null>;

function emptyMap(): EarCompensationMap {
  return { LEFT: null, RIGHT: null };
}

function toEarCompensation(profile: HearingProfile): EarCompensation {
  return profile.configJson as unknown as EarCompensation;
}

/** 读取用户的左右耳补偿参数（可能只有一侧）。 */
export async function loadEarCompensations(userId: string): Promise<EarCompensationMap> {
  const profiles = await prisma.hearingProfile.findMany({ where: { userId } });
  const map = emptyMap();
  for (const profile of profiles) {
    if ((EARS as string[]).includes(profile.ear)) {
      map[profile.ear as Ear] = toEarCompensation(profile);
    }
  }
  return map;
}

/** 读取并合成双耳合计配置；两侧都未测听时返回 null。 */
export async function loadBinauralConfig(
  userId: string,
): Promise<{ ears: EarCompensationMap; profiles: HearingProfile[]; config: CompensationConfig } | null> {
  const profiles = await prisma.hearingProfile.findMany({
    where: { userId },
    orderBy: { ear: 'asc' },
  });
  if (profiles.length === 0) return null;

  const ears = emptyMap();
  for (const profile of profiles) {
    if ((EARS as string[]).includes(profile.ear)) {
      ears[profile.ear as Ear] = toEarCompensation(profile);
    }
  }

  return { ears, profiles, config: buildBinauralConfig(ears) };
}

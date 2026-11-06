import type { HearingProfile, HearingTest, HearingTestResult } from '@prisma/client';

export interface PublicUser {
  id: string;
  username: string;
  nickname: string | null;
  role: string;
  status: string;
  createdAt: string;
}

/** 对外暴露的用户信息，绝不包含 passwordHash。 */
export function toPublicUser(user: {
  id: string;
  username: string;
  nickname: string | null;
  role: string;
  status: string;
  createdAt: Date;
}): PublicUser {
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
  };
}

export interface HearingResultDto {
  frequency: number;
  level: number;
  heard: boolean;
}

export interface HearingTestDto {
  id: string;
  ear: HearingTest['ear'];
  status: HearingTest['status'];
  deviceNote: string | null;
  startedAt: string;
  finishedAt: string | null;
  resultCount: number;
  results: HearingResultDto[];
}

export function toTestDto(
  test: HearingTest & { results?: HearingTestResult[] },
): HearingTestDto {
  const results = (test.results ?? [])
    .map((item) => ({ frequency: item.frequency, level: item.level, heard: item.heard }))
    .sort((a, b) => a.frequency - b.frequency || a.level - b.level);

  return {
    id: test.id,
    ear: test.ear,
    status: test.status,
    deviceNote: test.deviceNote,
    startedAt: test.startedAt.toISOString(),
    finishedAt: test.finishedAt ? test.finishedAt.toISOString() : null,
    resultCount: results.length,
    results,
  };
}

export interface HearingProfileDto {
  id: string;
  ear: HearingProfile['ear'];
  sourceTestId: string | null;
  updatedAt: string;
  config: unknown;
}

export function toProfileDto(profile: HearingProfile): HearingProfileDto {
  return {
    id: profile.id,
    ear: profile.ear,
    sourceTestId: profile.sourceTestId,
    updatedAt: profile.updatedAt.toISOString(),
    config: profile.configJson,
  };
}

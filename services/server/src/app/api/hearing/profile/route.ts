import { Prisma } from '@prisma/client';
import type { NextRequest } from 'next/server';
import { buildEarCompensation, type Ear } from '@/lib/audiogram';
import { requireUser } from '@/lib/auth';
import { forbidden, invalidInput, notFound } from '@/lib/errors';
import { readJson, runRoute } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { loadBinauralConfig } from '@/lib/profile';
import { profileUpdateSchema } from '@/lib/schemas';
import { toProfileDto, type HearingProfileDto } from '@/lib/serializers';
import { success } from '@/utils/response';

function groupProfiles(
  profiles: Awaited<ReturnType<typeof prisma.hearingProfile.findMany>>,
): Record<Ear, HearingProfileDto | null> {
  const grouped: Record<Ear, HearingProfileDto | null> = { LEFT: null, RIGHT: null };
  for (const profile of profiles) {
    if (profile.ear === 'LEFT' || profile.ear === 'RIGHT') {
      grouped[profile.ear] = toProfileDto(profile);
    }
  }
  return grouped;
}

/** 读取左右耳档案与双耳合计配置。 */
export async function GET(request: NextRequest) {
  return runRoute(async () => {
    const user = await requireUser(request);
    const binaural = await loadBinauralConfig(user.id);
    if (!binaural) throw notFound('尚未生成听力补偿档案，请先完成一次听力自测');

    return success(
      {
        profiles: groupProfiles(binaural.profiles),
        config: binaural.config,
      },
      'ok',
    );
  });
}

/** 删除云端档案（撤回同步同意时调用，确保服务端不再保留数据）。 */
export async function DELETE(request: NextRequest) {
  return runRoute(async () => {
    const user = await requireUser(request);
    const result = await prisma.hearingProfile.deleteMany({ where: { userId: user.id } });
    return success({ deleted: result.count }, '云端档案已删除');
  });
}

/**
 * 更新指定耳别的补偿档案：
 * - 传 sourceTestId：按该次自测结果重新计算（推荐，保证可追溯）；
 * - 传 config：直接保存自定义配置（高级用户/桌面端导入）。
 */
export async function PUT(request: NextRequest) {
  return runRoute(async () => {
    const user = await requireUser(request);
    const payload = profileUpdateSchema.parse(await readJson(request));
    const ear = payload.ear;

    if (!payload.sourceTestId) {
      const configJson = payload.config as unknown as Prisma.InputJsonValue;
      await prisma.hearingProfile.upsert({
        where: { userId_ear: { userId: user.id, ear } },
        create: { userId: user.id, ear, configJson },
        update: { configJson },
      });
    } else {
      const test = await prisma.hearingTest.findUnique({
        where: { id: payload.sourceTestId },
        include: { results: true },
      });
      if (!test) throw notFound('来源自测记录不存在');
      if (test.userId !== user.id) throw forbidden('无权使用他人的自测记录');
      if (test.ear !== ear) throw invalidInput('来源自测记录的耳别与目标耳别不一致');
      if (test.results.length === 0) throw invalidInput('该自测记录没有结果数据');

      const earCompensation = buildEarCompensation({
        ear,
        testId: test.id,
        results: test.results.map((item) => ({
          frequency: item.frequency,
          level: item.level,
          heard: item.heard,
        })),
      });

      const configJson = earCompensation as unknown as Prisma.InputJsonValue;
      await prisma.hearingProfile.upsert({
        where: { userId_ear: { userId: user.id, ear } },
        create: { userId: user.id, ear, sourceTestId: test.id, configJson },
        update: { sourceTestId: test.id, configJson },
      });
    }

    const binaural = await loadBinauralConfig(user.id);
    return success(
      {
        ear,
        profiles: binaural ? groupProfiles(binaural.profiles) : { LEFT: null, RIGHT: null },
        config: binaural?.config ?? null,
      },
      `已更新${ear === 'LEFT' ? '左' : '右'}耳补偿配置`,
    );
  });
}

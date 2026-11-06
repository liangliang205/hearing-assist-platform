import { Prisma } from '@prisma/client';
import type { NextRequest } from 'next/server';
import { buildEarCompensation } from '@/lib/audiogram';
import { requireUser } from '@/lib/auth';
import { forbidden, invalidInput, notFound } from '@/lib/errors';
import { readJson, runRoute } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { loadBinauralConfig } from '@/lib/profile';
import { hearingTestPatchSchema } from '@/lib/schemas';
import { toProfileDto, toTestDto } from '@/lib/serializers';
import { success } from '@/utils/response';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function loadOwnedTest(request: NextRequest, id: string) {
  const user = await requireUser(request);
  const test = await prisma.hearingTest.findUnique({ where: { id } });
  if (!test) throw notFound('自测记录不存在');
  if (test.userId !== user.id) throw forbidden('无权访问他人的自测记录');
  return { user, test };
}

export async function GET(request: NextRequest, context: RouteContext) {
  return runRoute(async () => {
    const { id } = await context.params;
    await loadOwnedTest(request, id);
    const test = await prisma.hearingTest.findUnique({
      where: { id },
      include: { results: true },
    });
    return success({ test: toTestDto(test!) }, 'ok');
  });
}

/**
 * 提交/追加测听结果；complete=true 时汇总该耳听阈并更新对应耳别的补偿档案。
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  return runRoute(async () => {
    const { id } = await context.params;
    const { user, test } = await loadOwnedTest(request, id);
    const payload = hearingTestPatchSchema.parse(await readJson(request));

    if (payload.results) {
      await prisma.$transaction([
        prisma.hearingTestResult.deleteMany({ where: { testId: id } }),
        prisma.hearingTestResult.createMany({
          data: payload.results.map((result) => ({
            testId: id,
            frequency: result.frequency,
            level: result.level,
            heard: result.heard,
          })),
        }),
      ]);
    }

    if (payload.deviceNote !== undefined) {
      await prisma.hearingTest.update({
        where: { id },
        data: { deviceNote: payload.deviceNote },
      });
    }

    if (!payload.complete) {
      const refreshed = await prisma.hearingTest.findUnique({
        where: { id },
        include: { results: true },
      });
      return success({ test: toTestDto(refreshed!) }, '已保存自测结果');
    }

    const results = await prisma.hearingTestResult.findMany({ where: { testId: id } });
    if (results.length === 0) throw invalidInput('尚未提交任何测听结果，无法完成自测');

    const earCompensation = buildEarCompensation({
      ear: test.ear,
      testId: id,
      results: results.map((item) => ({
        frequency: item.frequency,
        level: item.level,
        heard: item.heard,
      })),
    });

    const configJson = earCompensation as unknown as Prisma.InputJsonValue;
    const [profile] = await prisma.$transaction([
      prisma.hearingProfile.upsert({
        where: { userId_ear: { userId: user.id, ear: test.ear } },
        create: { userId: user.id, ear: test.ear, sourceTestId: id, configJson },
        update: { sourceTestId: id, configJson },
      }),
      prisma.hearingTest.update({
        where: { id },
        data: { status: 'COMPLETED', finishedAt: new Date() },
      }),
    ]);

    const completed = await prisma.hearingTest.findUnique({
      where: { id },
      include: { results: true },
    });
    const binaural = await loadBinauralConfig(user.id);

    return success(
      {
        test: toTestDto(completed!),
        profile: toProfileDto(profile),
        config: binaural?.config ?? null,
      },
      `${test.ear === 'LEFT' ? '左耳' : '右耳'}自测完成，已更新补偿配置`,
    );
  });
}

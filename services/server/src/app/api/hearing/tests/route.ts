import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { readJson, runRoute } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { hearingTestCreateSchema } from '@/lib/schemas';
import { toTestDto } from '@/lib/serializers';
import { success } from '@/utils/response';

/** 我的自测记录列表（最近 20 条）。可用 ?ear=LEFT 过滤单侧。 */
export async function GET(request: NextRequest) {
  return runRoute(async () => {
    const user = await requireUser(request);
    const earParam = request.nextUrl.searchParams.get('ear');
    const ear = earParam === 'LEFT' || earParam === 'RIGHT' ? earParam : undefined;

    const tests = await prisma.hearingTest.findMany({
      where: { userId: user.id, ...(ear ? { ear } : {}) },
      orderBy: { startedAt: 'desc' },
      take: 20,
      include: { results: true },
    });
    return success({ tests: tests.map((test) => toTestDto(test)) }, 'ok');
  });
}

/** 开启一次新的听力自测会话（一次只测一侧耳）。 */
export async function POST(request: NextRequest) {
  return runRoute(async () => {
    const user = await requireUser(request);
    const payload = hearingTestCreateSchema.parse(await readJson(request));
    const test = await prisma.hearingTest.create({
      data: {
        userId: user.id,
        ear: payload.ear,
        deviceNote: payload.deviceNote ?? null,
      },
    });
    return success({ test: toTestDto(test) }, '已创建听力自测会话');
  });
}

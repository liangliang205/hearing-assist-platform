import type { NextRequest } from 'next/server';
import { AUTH_COOKIE, hashPassword, sessionCookieOptions, signSessionToken } from '@/lib/auth';
import { conflict } from '@/lib/errors';
import { readJson, runRoute } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { registerSchema } from '@/lib/schemas';
import { toPublicUser } from '@/lib/serializers';
import { success } from '@/utils/response';

export async function POST(request: NextRequest) {
  return runRoute(async () => {
    const payload = registerSchema.parse(await readJson(request));

    const existing = await prisma.user.findUnique({ where: { username: payload.username } });
    if (existing) throw conflict('用户名已被占用');

    const user = await prisma.user.create({
      data: {
        username: payload.username,
        passwordHash: await hashPassword(payload.password),
        nickname: payload.nickname ?? null,
      },
    });

    const token = await signSessionToken(user.id);
    const response = success({ user: toPublicUser(user) }, '注册成功');
    response.cookies.set(AUTH_COOKIE, token, sessionCookieOptions());
    return response;
  });
}

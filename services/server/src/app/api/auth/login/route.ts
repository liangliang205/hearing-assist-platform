import type { NextRequest } from 'next/server';
import { AUTH_COOKIE, sessionCookieOptions, signSessionToken, verifyPassword } from '@/lib/auth';
import { AppError, forbidden } from '@/lib/errors';
import { readJson, runRoute } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { loginSchema } from '@/lib/schemas';
import { toPublicUser } from '@/lib/serializers';
import { success } from '@/utils/response';

export async function POST(request: NextRequest) {
  return runRoute(async () => {
    const payload = loginSchema.parse(await readJson(request));

    const user = await prisma.user.findUnique({ where: { username: payload.username } });
    const passwordMatched = user ? await verifyPassword(payload.password, user.passwordHash) : false;
    if (!user || !passwordMatched) {
      throw new AppError('E1102', '用户名或密码不正确', 401);
    }
    if (user.status !== 'ACTIVE') throw forbidden('账号已被停用');

    const token = await signSessionToken(user.id);
    const response = success({ user: toPublicUser(user) }, '登录成功');
    response.cookies.set(AUTH_COOKIE, token, sessionCookieOptions());
    return response;
  });
}

import { compare, hash } from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import type { NextRequest } from 'next/server';
import type { User } from '@prisma/client';
import { AppError, unauthorized } from './errors';
import { prisma } from './prisma';

/** 会话 Cookie 名。httpOnly + SameSite=Lax，前端不接触令牌明文。 */
export const AUTH_COOKIE = 'hl_session';

/** 会话有效期：7 天。 */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new AppError('E9002', '服务端未配置安全的 JWT_SECRET（至少 32 字符）', 500);
  }
  return new TextEncoder().encode(secret);
}

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, 10);
}

export async function verifyPassword(plain: string, digest: string): Promise<boolean> {
  return compare(plain, digest);
}

export async function signSessionToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getSecret());
}

export async function readSessionUserId(request: NextRequest): Promise<string | null> {
  const token = request.cookies.get(AUTH_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function requireUser(request: NextRequest): Promise<User> {
  const userId = await readSessionUserId(request);
  if (!userId) throw unauthorized();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.status !== 'ACTIVE') throw unauthorized('账号不存在或已被停用');
  return user;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  };
}

export function expiredCookieOptions() {
  return { ...sessionCookieOptions(), maxAge: 0 };
}

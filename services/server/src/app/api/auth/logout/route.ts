import type { NextRequest } from 'next/server';
import { AUTH_COOKIE, expiredCookieOptions } from '@/lib/auth';
import { runRoute } from '@/lib/http';
import { success } from '@/utils/response';

export async function POST(_request: NextRequest) {
  return runRoute(async () => {
    const response = success({ loggedOut: true }, '已退出登录');
    response.cookies.set(AUTH_COOKIE, '', expiredCookieOptions());
    return response;
  });
}

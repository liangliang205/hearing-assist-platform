import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { runRoute } from '@/lib/http';
import { toPublicUser } from '@/lib/serializers';
import { success } from '@/utils/response';

export async function GET(request: NextRequest) {
  return runRoute(async () => {
    const user = await requireUser(request);
    return success({ user: toPublicUser(user) }, 'ok');
  });
}

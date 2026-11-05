import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { notFound } from '@/lib/errors';
import { runRoute } from '@/lib/http';
import { loadBinauralConfig } from '@/lib/profile';
import { success } from '@/utils/response';

/**
 * 导出可直接被外部客户端消费的双耳补偿配置 JSON。
 * 这份契约面向系统级实时处理端（WASAPI / APO / 虚拟声卡），
 * 浏览器预览与桌面端共用同一套参数，避免两套逻辑漂移。
 */
export async function GET(request: NextRequest) {
  return runRoute(async () => {
    const user = await requireUser(request);
    const binaural = await loadBinauralConfig(user.id);
    if (!binaural) throw notFound('尚未生成听力补偿配置，请先完成至少一侧的听力自测');
    return success(binaural.config, 'ok');
  });
}

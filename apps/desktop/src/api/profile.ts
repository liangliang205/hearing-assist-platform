import type { CompensationConfig, Ear, EarCompensation } from '@hearlink/domain';
import { apiRequest } from './client';

/** 服务端单耳档案：`config` 才是 EarCompensation，外层是档案元信息。 */
export interface RemoteEarProfile {
  id: string;
  ear: Ear;
  sourceTestId: string | null;
  updatedAt: string;
  config: EarCompensation;
}

/** 服务端档案接口的返回结构。 */
export interface RemoteProfilePayload {
  profiles: Record<Ear, RemoteEarProfile | null>;
  config: CompensationConfig | null;
}

export const profileApi = {
  /** 读取云端双耳档案；尚未同步过会抛 404。 */
  get: () => apiRequest<RemoteProfilePayload>('/api/hearing/profile'),

  /**
   * 上传单耳补偿配置。
   *
   * 直接传算好的 `config`（EarCompensation），而不是传 sourceTestId：
   * 桌面端在本地完成测听与处方计算，服务端只负责存储与跨设备分发。
   */
  pushEar: (ear: Ear, config: EarCompensation) =>
    apiRequest<RemoteProfilePayload>('/api/hearing/profile', {
      method: 'PUT',
      body: JSON.stringify({ ear, config }),
    }),

  /** 删除云端全部档案（撤回同步同意时调用）。 */
  deleteCloud: () =>
    apiRequest<{ deleted: number }>('/api/hearing/profile', { method: 'DELETE' }),
};

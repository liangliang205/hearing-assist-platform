/**
 * 服务端通信薄封装。
 *
 * 约定：
 * - 所有接口返回 `{ code, message, data, traceId }`，code 为 0 表示成功；
 * - 会话走 httpOnly Cookie，前端不接触令牌，因此请求必须带 credentials；
 * - 默认走同源（Vite 开发代理），打包后可用 VITE_API_BASE_URL 指向独立服务端。
 */

export interface ApiEnvelope<T> {
  code: number | string;
  message: string;
  data: T | null;
  traceId: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | number;

  constructor(message: string, status: number, code: string | number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isNetwork(): boolean {
    return this.code === 'NETWORK';
  }
}

const BASE_URL = (
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''
).replace(/\/$/, '');

/** 服务端是否可达（游客模式下用于静默降级）。 */
export const API_BASE_URL = BASE_URL || '同源代理';

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
  } catch {
    throw new ApiError('无法连接服务端，请确认服务已启动（默认 http://localhost:3000）', 0, 'NETWORK');
  }

  let envelope: ApiEnvelope<T> | null = null;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch {
    envelope = null;
  }

  if (!response.ok || !envelope || envelope.code !== 0) {
    throw new ApiError(
      envelope?.message ?? `请求失败（HTTP ${response.status}）`,
      response.status,
      envelope?.code ?? response.status,
    );
  }

  return envelope.data as T;
}

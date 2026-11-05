const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '/api';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface Envelope<T> {
  code: number | string;
  message: string;
  data: T | null;
  traceId?: string;
}

/**
 * 统一请求封装：
 * - 始终携带 Cookie（会话由后端 httpOnly Cookie 维护）
 * - 按 { code, message, data } 解包，非 0 视为错误
 */
export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const { headers, ...rest } = init ?? {};
  const response = await fetch(`${apiBaseUrl}${path}`, {
    credentials: 'include',
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });

  const text = await response.text();
  let payload: Envelope<T> | null = null;
  if (text) {
    try {
      payload = JSON.parse(text) as Envelope<T>;
    } catch {
      payload = null;
    }
  }

  if (!response.ok || !payload || payload.code !== 0) {
    throw new ApiError(
      payload ? String(payload.code) : `HTTP_${response.status}`,
      payload?.message ?? `请求失败（HTTP ${response.status}）`,
      response.status,
    );
  }

  return payload.data as T;
}

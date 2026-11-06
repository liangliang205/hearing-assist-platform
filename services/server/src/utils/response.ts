import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';

/**
 * 全站统一响应体，字段与《项目文档④ 接口规范》一致：
 * { code, message, data, traceId }
 * code 为 0 表示成功，其余为 E 开头或数字错误码。
 */
export interface ApiEnvelope<T> {
  code: number | string;
  message: string;
  data: T | null;
  traceId: string;
}

export function success<T>(data: T, message = 'ok', init?: ResponseInit): NextResponse<ApiEnvelope<T>> {
  const body: ApiEnvelope<T> = {
    code: 0,
    message,
    data,
    traceId: randomUUID(),
  };
  return NextResponse.json(body, init);
}

export function failure(code: string, message: string, status = 400): NextResponse<ApiEnvelope<never>> {
  const body: ApiEnvelope<never> = {
    code,
    message,
    data: null,
    traceId: randomUUID(),
  };
  return NextResponse.json(body, { status });
}

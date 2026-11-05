import { ZodError } from 'zod';
import { AppError, invalidInput } from './errors';
import { failure } from '@/utils/response';

/** 读取并校验 JSON 请求体，非法 JSON 统一转成 422。 */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw invalidInput('请求体必须是合法 JSON');
  }
}

/**
 * 统一的路由错误出口：把业务异常、参数校验失败和未捕获异常
 * 都转换成 { code, message, data, traceId } 响应，避免每个路由重复 try/catch。
 */
export async function runRoute(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof AppError) {
      return failure(error.code, error.message, error.status);
    }
    if (error instanceof ZodError) {
      const message = error.issues
        .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
        .join('; ');
      return failure('E1002', `参数校验失败：${message}`, 422);
    }
    console.error('[api] unhandled error:', error);
    return failure('E9001', '服务器内部错误', 500);
  }
}

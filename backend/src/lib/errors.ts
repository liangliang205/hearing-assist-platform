/**
 * 业务异常。code 与《项目文档④ 接口规范》中的错误码表对齐：
 * E1xxx 认证与账号，E2xxx 听力测试/档案，E9xxx 系统级错误。
 */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const unauthorized = (message = '未登录或登录已过期') => new AppError('E1001', message, 401);
export const forbidden = (message = '无权访问该资源') => new AppError('E1003', message, 403);
export const notFound = (message = '资源不存在') => new AppError('E1004', message, 404);
export const conflict = (message: string) => new AppError('E1005', message, 409);
export const invalidInput = (message: string) => new AppError('E1002', message, 422);

import { apiRequest } from './client';

/** 服务端返回的公开用户信息（不含任何凭据）。 */
export interface PublicUser {
  id: string;
  username: string;
  nickname: string | null;
  role: string;
  status: string;
  createdAt: string;
}

export interface AuthResult {
  user: PublicUser;
}

export interface RegisterInput {
  username: string;
  password: string;
  nickname?: string;
}

export const authApi = {
  /** 读取当前会话；未登录会抛 401（游客模式据此静默降级）。 */
  me: () => apiRequest<AuthResult>('/api/auth/me'),

  login: (username: string, password: string) =>
    apiRequest<AuthResult>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  register: (input: RegisterInput) =>
    apiRequest<AuthResult>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  logout: () => apiRequest<null>('/api/auth/logout', { method: 'POST' }),
};

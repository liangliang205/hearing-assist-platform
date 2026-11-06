import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { authApi, type PublicUser, type RegisterInput } from '../api/auth';
import { ApiError } from '../api/client';

interface AuthContextValue {
  user: PublicUser | null;
  /** 首次会话检查是否完成（避免顶栏闪烁）。 */
  ready: boolean;
  /** 服务端是否可达；不可达时静默降级为游客模式。 */
  serverReachable: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [ready, setReady] = useState(false);
  const [serverReachable, setServerReachable] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const result = await authApi.me();
        if (!cancelled) setUser(result.user);
      } catch (error) {
        // 401 = 未登录（游客），属正常情况；网络错误才标记服务端不可达
        if (!cancelled && error instanceof ApiError && error.isNetwork) {
          setServerReachable(false);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const result = await authApi.login(username, password);
    setUser(result.user);
    setServerReachable(true);
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const result = await authApi.register(input);
    setUser(result.user);
    setServerReachable(true);
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, ready, serverReachable, login, register, logout }),
    [user, ready, serverReachable, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return context;
}

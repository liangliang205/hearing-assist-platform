import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { profileApi } from '../api/profile';
import {
  acceptConsent,
  consentStateOf,
  declineConsent,
  readConsent,
  revokeConsent,
  type ConsentRecord,
  type ConsentState,
} from './consent';

interface PrivacyContextValue {
  state: ConsentState;
  record: ConsentRecord | null;
  ready: boolean;
  /** 用户主动要求重新查看隐私说明（例如在设置页点「开启同步」）。 */
  showRequested: boolean;
  accept: () => Promise<void>;
  decline: () => Promise<void>;
  /** 撤回同意：停止同步并删除云端档案；返回云端是否删除成功。 */
  revoke: () => Promise<boolean>;
  prompt: () => void;
  dismissPrompt: () => void;
}

const PrivacyContext = createContext<PrivacyContextValue | null>(null);

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [record, setRecord] = useState<ConsentRecord | null>(null);
  const [ready, setReady] = useState(false);
  const [showRequested, setShowRequested] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await readConsent();
      if (!cancelled) {
        setRecord(stored);
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const accept = useCallback(async () => {
    await acceptConsent();
    setRecord(await readConsent());
    setShowRequested(false);
  }, []);

  const decline = useCallback(async () => {
    await declineConsent();
    setRecord(await readConsent());
    setShowRequested(false);
  }, []);

  const revoke = useCallback(async () => {
    let deleted = false;
    try {
      await profileApi.deleteCloud();
      deleted = true;
    } catch {
      deleted = false;
    }
    await revokeConsent();
    setRecord(await readConsent());
    setShowRequested(false);
    return deleted;
  }, []);

  const prompt = useCallback(() => setShowRequested(true), []);
  const dismissPrompt = useCallback(() => setShowRequested(false), []);

  const value = useMemo<PrivacyContextValue>(
    () => ({
      state: consentStateOf(record),
      record,
      ready,
      showRequested,
      accept,
      decline,
      revoke,
      prompt,
      dismissPrompt,
    }),
    [record, ready, showRequested, accept, decline, revoke, prompt, dismissPrompt],
  );

  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
}

export function usePrivacy(): PrivacyContextValue {
  const context = useContext(PrivacyContext);
  if (!context) throw new Error('usePrivacy 必须在 PrivacyProvider 内使用');
  return context;
}

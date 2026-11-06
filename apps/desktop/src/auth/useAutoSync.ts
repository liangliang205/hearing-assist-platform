import { useEffect, useRef } from 'react';
import { message } from 'antd';
import { useAuth } from './AuthProvider';
import { usePrivacy } from '../privacy/PrivacyProvider';
import { autoSync, mergeWithCloud, setSyncEnabled } from '../api/sync';

/**
 * 自动同步的触发点：
 * 1. 登录后立即做一次双向合并（云端更新就导入，本地更新就上传）；
 * 2. 窗口重新获得焦点时合并一次（覆盖离线期间任一侧的改动）；
 * 3. 每分钟兜底一次。
 *
 * 「刚改完档案」的即时上传由写入方（测听完成 / 重算补偿）直接调用 autoSync。
 */
export function useAutoSync() {
  const { user } = useAuth();
  const { state: consentState } = usePrivacy();
  const announced = useRef(false);

  useEffect(() => {
    // 必须同时满足「已登录」与「已同意隐私说明」，否则一个字节都不上传
    const enabled = Boolean(user) && consentState === 'accepted';
    setSyncEnabled(enabled, user?.id);
    if (!enabled) return;

    let cancelled = false;

    void (async () => {
      try {
        const result = await mergeWithCloud();
        if (cancelled || result.pulled === 0 || announced.current) return;
        announced.current = true;
        message.info(`已从云端导入 ${result.pulled} 只耳的补偿配置`);
      } catch {
        // 静默：下个触发点会重试
      }
    })();

    const onFocus = () => {
      void mergeWithCloud().catch(() => undefined);
    };

    window.addEventListener('focus', onFocus);
    const timer = window.setInterval(() => {
      void mergeWithCloud().catch(() => undefined);
    }, 60_000);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      window.clearInterval(timer);
    };
  }, [user]);

  // 页面卸载前尽力把未同步的改动推上去（不保证一定完成，兜底而已）
  useEffect(() => {
    if (!user) return;
    const onHide = () => {
      void autoSync();
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [user]);
}

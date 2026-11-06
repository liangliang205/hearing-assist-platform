import { localStore } from '../store';

/**
 * 同步同意的本地记录。
 *
 * 隐私要求（需求文档 §4.8）：未明确勾选同意前，服务端收不到任何用户数据；
 * 同意可随时撤回，撤回后停止上传并删除云端档案。
 */

export const PRIVACY_VERSION = '2026-11';

const SETTING_KEY = 'privacy.consent';

export type ConsentState = 'pending' | 'accepted' | 'declined';

export interface ConsentRecord {
  version: string;
  acceptedAt: string | null;
  declinedAt: string | null;
  revokedAt: string | null;
}

export function consentStateOf(record: ConsentRecord | null): ConsentState {
  if (!record || record.version !== PRIVACY_VERSION) return 'pending';
  if (record.acceptedAt && !record.revokedAt) return 'accepted';
  if (record.declinedAt || record.revokedAt) return 'declined';
  return 'pending';
}

export async function readConsent(): Promise<ConsentRecord | null> {
  const raw = await localStore.getSetting(SETTING_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ConsentRecord;
  } catch {
    return null;
  }
}

async function writeConsent(record: ConsentRecord): Promise<void> {
  await localStore.setSetting(SETTING_KEY, JSON.stringify(record));
}

export async function acceptConsent(): Promise<void> {
  await writeConsent({
    version: PRIVACY_VERSION,
    acceptedAt: new Date().toISOString(),
    declinedAt: null,
    revokedAt: null,
  });
}

export async function declineConsent(): Promise<void> {
  await writeConsent({
    version: PRIVACY_VERSION,
    acceptedAt: null,
    declinedAt: new Date().toISOString(),
    revokedAt: null,
  });
}

export async function revokeConsent(): Promise<void> {
  await writeConsent({
    version: PRIVACY_VERSION,
    acceptedAt: null,
    declinedAt: null,
    revokedAt: new Date().toISOString(),
  });
}

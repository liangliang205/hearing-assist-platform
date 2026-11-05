import { apiRequest } from './client';
import type {
  CompensationConfig,
  Ear,
  EarProfileMap,
  HearingResult,
  HearingTest,
  HearingTestPatchResponse,
  ProfileResponse,
  User,
} from '../types';

export const authApi = {
  me: () => apiRequest<{ user: User }>('/auth/me'),
  login: (input: { username: string; password: string }) =>
    apiRequest<{ user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  register: (input: { username: string; password: string; nickname?: string }) =>
    apiRequest<{ user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  logout: () => apiRequest<{ loggedOut: boolean }>('/auth/logout', { method: 'POST' }),
};

export const hearingApi = {
  listTests: (ear?: Ear) =>
    apiRequest<{ tests: HearingTest[] }>(`/hearing/tests${ear ? `?ear=${ear}` : ''}`),
  createTest: (ear: Ear, deviceNote?: string) =>
    apiRequest<{ test: HearingTest }>('/hearing/tests', {
      method: 'POST',
      body: JSON.stringify({ ear, deviceNote }),
    }),
  getTest: (id: string) => apiRequest<{ test: HearingTest }>(`/hearing/tests/${id}`),
  submitResults: (id: string, results: HearingResult[], complete = false, deviceNote?: string) =>
    apiRequest<HearingTestPatchResponse>(`/hearing/tests/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ results, complete, deviceNote }),
    }),
  getProfile: () => apiRequest<ProfileResponse>('/hearing/profile'),
  getConfig: () => apiRequest<CompensationConfig>('/hearing/profile/config'),
  rebuildFromTest: (ear: Ear, sourceTestId: string) =>
    apiRequest<{ ear: Ear; profiles: EarProfileMap; config: CompensationConfig | null }>(
      '/hearing/profile',
      {
        method: 'PUT',
        body: JSON.stringify({ ear, sourceTestId }),
      },
    ),
};

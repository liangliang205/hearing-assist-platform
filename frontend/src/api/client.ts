const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '/api';

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    ...init,
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  const payload = (await response.json()) as { data: T; message?: string };
  return payload.data;
}

import type {
  Investigation,
  NotFound,
  RecentItem,
  Stats,
  SearchEvent,
  AnalyticsSummary,
  ModelResponse,
  SmishingAnalysis,
} from './types.ts';

export interface User { id: string; email: string; name: string; role: 'user' | 'admin' }
export interface AuthResponse { token: string; user: User }

const TOKEN_KEY = 'osint_jwt_token';
let authToken: string | null = typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;

export const getAuthToken = (): string | null => authToken;
export const setAuthToken = (token: string | null): void => {
  authToken = token;
  if (typeof localStorage !== 'undefined') {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  }
};

// All data comes from the backend's local database / public sources -- the browser never contacts a suspected target.
export type SearchBody = Investigation | NotFound | { error: string };

async function requestJson<T>(path: string, options: RequestInit = {}): Promise<{ status: number; body: T }> {
  const headers = new Headers(options.headers || {});
  if (authToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }
  const res = await fetch(path, { ...options, headers });
  const body = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, body };
}

export const search = (q: string, refresh = false) =>
  requestJson<SearchBody>(`/api/search?q=${encodeURIComponent(q)}${refresh ? '&refresh=1' : ''}`);

export const getRecent = async (): Promise<RecentItem[]> => {
  const { body } = await requestJson<RecentItem[]>('/api/recent?limit=12');
  return Array.isArray(body) ? body : [];
};

export const getStats = async (): Promise<Stats> => (await requestJson<Stats>('/api/stats')).body;

export const login = (email: string, password: string) =>
  requestJson<AuthResponse>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

export const register = (email: string, password: string, name: string) =>
  requestJson<AuthResponse>('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });

export const getMe = () => requestJson<{ user: User }>('/api/auth/me');

export const logout = async () => {
  try {
    await requestJson('/api/auth/logout', { method: 'POST' });
  } finally {
    setAuthToken(null);
  }
};

export const ensureSession = async (): Promise<User | null> => {
  if (authToken) {
    try {
      const me = await getMe();
      if (me.status === 200 && me.body?.user) return me.body.user;
    } catch {
      // ignore
    }
    // Token is invalid/expired
    setAuthToken(null);
  }
  return null;
};

export const getHistory = async (limit = 50): Promise<SearchEvent[]> => {
  const { body } = await requestJson<SearchEvent[]>(`/api/history?limit=${limit}`);
  return Array.isArray(body) ? body : [];
};

export const deleteHistoryItem = async (id: string): Promise<boolean> => {
  const { status } = await requestJson(`/api/history/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return status === 204;
};

export const clearHistory = async (): Promise<{ deleted: number }> => {
  const { body } = await requestJson<{ deleted: number }>('/api/history', { method: 'DELETE' });
  return body || { deleted: 0 };
};

export const getAnalytics = async (scope: 'me' | 'all' = 'me', days = 30): Promise<AnalyticsSummary | null> => {
  const { status, body } = await requestJson<AnalyticsSummary>(`/api/analytics?scope=${scope}&days=${days}`);
  return status === 200 ? body : null;
};

export const getModelInfo = async (): Promise<ModelResponse | null> => {
  const { status, body } = await requestJson<ModelResponse>('/api/model');
  return status === 200 ? body : null;
};

export const trainModel = async (provider: 'graph' | 'synthetic'): Promise<{ model: ModelResponse['model'] } | { error: string }> => {
  const { body } = await requestJson<{ model: ModelResponse['model']; error?: string }>('/api/model/train', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider }),
  });
  return body;
};

export const refreshFeeds = async (): Promise<unknown> => {
  const { body } = await requestJson('/api/feeds/refresh', { method: 'POST' });
  return body;
};

export const triggerCorrelate = async (): Promise<unknown> => {
  const { body } = await requestJson('/api/correlate', { method: 'POST' });
  return body;
};

export const analyzeMessageApi = async (text: string, sender?: string): Promise<SmishingAnalysis> => {
  const { body } = await requestJson<SmishingAnalysis>('/api/message/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, sender }),
  });
  return body;
};

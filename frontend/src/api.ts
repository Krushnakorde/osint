/**
 * ============================================================================
 * MODULE: Frontend API Client & Session Manager
 * FILE: frontend/src/api.ts
 * ============================================================================
 *
 * WHAT THIS FILE DOES:
 * -------------------
 * This module is the centralized HTTP communication gateway for the frontend React
 * Single-Page Application (SPA). It provides typed asynchronous functions for:
 * - User authentication (registration, login, session recovery, logout).
 * - Target indicator investigations (`/api/search`).
 * - Smishing message NLP analysis (`/api/message/analyze`).
 * - Graph analytics, search history, AI model retraining, and admin triggers.
 *
 * CRITICAL SECURITY PRINCIPLE:
 * ----------------------------
 * Passive Client Architecture:
 * The investigator's web browser NEVER connects directly to a suspect phishing domain,
 * malicious IP, or command-and-control server. All lookups and intelligence gathering
 * are handled exclusively by our backend proxy. This shields the investigator from:
 * 1. IP leakage / de-anonymization (the scammer never logs the investigator's IP).
 * 2. Drive-by browser exploits and malicious cross-site scripts.
 * ============================================================================
 */

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

/** User profile schema received from the backend auth endpoints */
export interface User {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  dob?: string;
  residentialAddress?: string;
  phone?: string;
  businessNature?: string;
}

/** Authentication response containing the signed JWT, rotated refresh token, and the user profile */
export interface AuthResponse {
  token: string;
  refreshToken?: string;
  expiresAt?: string;
  user: User;
}

/** Local storage keys used to persist credentials across browser reloads */
const TOKEN_KEY = 'osint_jwt_token';
const REFRESH_TOKEN_KEY = 'osint_refresh_token';

/** In-memory cache of the active JWT access token and rotated refresh token */
let authToken: string | null =
  typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
let refreshToken: string | null =
  typeof localStorage !== 'undefined' ? localStorage.getItem(REFRESH_TOKEN_KEY) : null;

/** Retrieves the current active JWT token */
export const getAuthToken = (): string | null => authToken;
/** Retrieves the current active refresh token */
export const getRefreshToken = (): string | null => refreshToken;

/**
 * Sets or clears the active JWT & refresh token in memory and persists them to browser LocalStorage.
 * Passing `null` removes the tokens (used during logout).
 */
export const setAuthToken = (token: string | null, newRefreshToken?: string | null): void => {
  authToken = token;
  if (typeof localStorage !== 'undefined') {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
      if (!localStorage.getItem('osint_login_time')) {
        localStorage.setItem('osint_login_time', String(Date.now()));
      }
    } else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem('osint_login_time');
      localStorage.removeItem('osint_remember_me');
    }
  }
  if (newRefreshToken !== undefined) {
    refreshToken = newRefreshToken;
    if (typeof localStorage !== 'undefined') {
      if (newRefreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, newRefreshToken);
      else localStorage.removeItem(REFRESH_TOKEN_KEY);
    }
  }
};

/** Refresh synchronization mutex and wait queue */
let isRefreshing = false;
let refreshQueue: Array<(token: string | null) => void> = [];

async function performRefresh(): Promise<string | null> {
  if (!refreshToken) return null;
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (res.status === 200) {
      const data = (await res.json()) as AuthResponse;
      if (data?.token) {
        setAuthToken(data.token, data.refreshToken ?? null);
        return data.token;
      }
    }
  } catch {
    // refresh failed
  }
  setAuthToken(null, null);
  return null;
}

/** Possible body responses returned by the investigation search endpoint */
export type SearchBody = Investigation | NotFound | { error: string };

/**
 * Core HTTP fetch wrapper.
 * Automatically injects the JWT Bearer authorization header if a session exists.
 * Transparently refreshes short-lived tokens and replays requests on 401s.
 */
async function requestJson<T>(
  path: string,
  options: RequestInit = {}
): Promise<{ status: number; body: T }> {
  const headers = new Headers(options.headers || {});
  if (authToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }
  const res = await fetch(path, { ...options, headers });

  // If 401 unauthenticated and we have a refreshToken, perform silent token rotation & retry
  if (
    res.status === 401 &&
    refreshToken &&
    !path.startsWith('/api/auth/refresh') &&
    !path.startsWith('/api/auth/login')
  ) {
    if (!isRefreshing) {
      isRefreshing = true;
      const newToken = await performRefresh();
      isRefreshing = false;
      refreshQueue.forEach((cb) => cb(newToken));
      refreshQueue = [];
      if (newToken) {
        headers.set('Authorization', `Bearer ${newToken}`);
        const retryRes = await fetch(path, { ...options, headers });
        const retryBody = (await retryRes.json().catch(() => ({}))) as T;
        return { status: retryRes.status, body: retryBody };
      }
    } else {
      const newToken = await new Promise<string | null>((resolve) => refreshQueue.push(resolve));
      if (newToken) {
        headers.set('Authorization', `Bearer ${newToken}`);
        const retryRes = await fetch(path, { ...options, headers });
        const retryBody = (await retryRes.json().catch(() => ({}))) as T;
        return { status: retryRes.status, body: retryBody };
      }
    }
  }

  const body = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, body };
}

// ----------------------------------------------------------------------------
// INVESTIGATION & SEARCH APIS
// ----------------------------------------------------------------------------

/**
 * Queries the fraud intelligence knowledge graph for a target indicator.
 *
 * @param q The indicator string (e.g. domain, phone, crypto wallet, IP, APK hash).
 * @param refresh If true, triggers fresh passive DNS/RDAP enrichment if indicator is new.
 */
export const search = (q: string, refresh = false) =>
  requestJson<SearchBody>(
    `/api/search?q=${encodeURIComponent(q)}${refresh ? '&refresh=1' : ''}`
  );

/** Fetches recent threat indicators observed across feeds */
export const getRecent = async (): Promise<RecentItem[]> => {
  const { body } = await requestJson<RecentItem[]>('/api/recent?limit=12');
  return Array.isArray(body) ? body : [];
};

/** Fetches overall graph database statistics (node counts, edge counts, cluster count) */
export const getStats = async (): Promise<Stats> =>
  (await requestJson<Stats>('/api/stats')).body;

// ----------------------------------------------------------------------------
// AUTHENTICATION APIS
// ----------------------------------------------------------------------------

export interface CaptchaData {
  id: string;
  svg: string;
  captchaToken: string;
}

/** Fetches a fresh cryptographic SVG CAPTCHA puzzle from the server */
export const getCaptcha = () => requestJson<CaptchaData>('/api/auth/captcha');

/** Authenticates user with email, password, and optional CAPTCHA, obtaining a signed JWT and refresh token */
export const login = (
  email: string,
  password: string,
  captchaToken?: string,
  captchaAnswer?: string
) =>
  requestJson<AuthResponse>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, captchaToken, captchaAnswer }),
  });

export interface RegisterPayload {
  email: string;
  password: string;
  name: string;
  dob?: string;
  residentialAddress?: string;
  phone?: string;
  businessNature?: string;
  captchaToken?: string;
  captchaAnswer?: string;
}

/** Registers a new account with profile validation and immediately receives tokens */
export const register = (
  input: RegisterPayload | string,
  legacyPassword?: string,
  legacyName?: string
) => {
  const payload =
    typeof input === 'string'
      ? { email: input, password: legacyPassword || '', name: legacyName || '' }
      : input;
  return requestJson<AuthResponse>('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
};

/** Retrieves the current authenticated user's profile using the stored Bearer token */
export const getMe = () => requestJson<{ user: User }>('/api/auth/me');

/** Requests a 6-digit password reset verification code */
export const requestPasswordReset = (email: string) =>
  requestJson<{ success: boolean; message: string; resetCode?: string }>('/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });

/** Submits verification code and sets a new password */
export const resetPassword = (email: string, code: string, newPassword: string) =>
  requestJson<{ success: boolean; message: string }>('/api/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code, newPassword }),
  });

/**
 * Terminates user session: notifies backend to revoke tokens,
 * and clears tokens from browser LocalStorage.
 */
export const logout = async () => {
  try {
    const rf = getRefreshToken();
    await requestJson('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rf }),
    });
  } finally {
    setAuthToken(null, null);
  }
};

/**
 * Emergency Security Killswitch: Invalides all active sessions across all devices worldwide.
 */
export const revokeAllSessions = async () =>
  requestJson<{ success: boolean; message: string }>('/api/auth/revoke-all', {
    method: 'POST',
  });

/**
 * Verifies active session on initial page load.
 * Supports seamless daily (24-hour) auto-login and automatic refresh token rotation.
 * Returns the User object if token is valid, or null if expired/invalid.
 */
export const ensureSession = async (): Promise<User | null> => {
  if (authToken || refreshToken) {
    const loginTimeStr =
      typeof localStorage !== 'undefined' ? localStorage.getItem('osint_login_time') : null;
    const isRemembered =
      typeof localStorage !== 'undefined' ? localStorage.getItem('osint_remember_me') !== 'false' : true;

    if (loginTimeStr && !isRemembered) {
      const elapsed = Date.now() - Number(loginTimeStr);
      const ONE_DAY_MS = 24 * 60 * 60 * 1000;
      if (elapsed > ONE_DAY_MS && !refreshToken) {
        setAuthToken(null, null);
        return null;
      }
    }

    try {
      const me = await getMe();
      if (me.status === 200 && me.body?.user) return me.body.user;
    } catch {
      // Network failure or invalid session
    }
    // Token is expired or revoked: purge it
    setAuthToken(null, null);
  }
  return null;
};

// ----------------------------------------------------------------------------
// AUDIT HISTORY & ANALYTICS APIS
// ----------------------------------------------------------------------------

/** Retrieves past investigation searches conducted by this user */
export const getHistory = async (limit = 50): Promise<SearchEvent[]> => {
  const { body } = await requestJson<SearchEvent[]>(`/api/history?limit=${limit}`);
  return Array.isArray(body) ? body : [];
};

/** Deletes a single search audit log entry */
export const deleteHistoryItem = async (id: string): Promise<boolean> => {
  const { status } = await requestJson(`/api/history/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  return status === 204;
};

/** Purges all investigation search audit logs for this user */
export const clearHistory = async (): Promise<{ deleted: number }> => {
  const { body } = await requestJson<{ deleted: number }>('/api/history', {
    method: 'DELETE',
  });
  return body || { deleted: 0 };
};

/** Fetches analytics summaries (query volume, threat distribution, peak activity heatmaps) */
export const getAnalytics = async (
  scope: 'me' | 'all' = 'me',
  days = 30
): Promise<AnalyticsSummary | null> => {
  const { status, body } = await requestJson<AnalyticsSummary>(
    `/api/analytics?scope=${scope}&days=${days}`
  );
  return status === 200 ? body : null;
};

// ----------------------------------------------------------------------------
// MACHINE LEARNING & ADMINISTRATIVE APIS
// ----------------------------------------------------------------------------

/** Fetches active Machine Learning model metadata, weights, and ROC-AUC metrics */
export const getModelInfo = async (): Promise<ModelResponse | null> => {
  const { status, body } = await requestJson<ModelResponse>('/api/model');
  return status === 200 ? body : null;
};

/** Triggers online supervised retraining of the Pure-TypeScript Logistic Regression model */
export const trainModel = async (
  provider: 'graph' | 'synthetic'
): Promise<{ model: ModelResponse['model'] } | { error: string }> => {
  const { body } = await requestJson<{ model: ModelResponse['model']; error?: string }>(
    '/api/model/train',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider }),
    }
  );
  return body;
};

/** Admin trigger: fetches fresh indicators from upstream threat feeds (URLhaus, OpenPhish) */
export const refreshFeeds = async (): Promise<unknown> => {
  const { body } = await requestJson('/api/feeds/refresh', { method: 'POST' });
  return body;
};

/** Admin trigger: executes bipartite graph syndicate correlation (Algorithm 9.1) */
export const triggerCorrelate = async (): Promise<unknown> => {
  const { body } = await requestJson('/api/correlate', { method: 'POST' });
  return body;
};

// ----------------------------------------------------------------------------
// SMISHING & SMS NLP ANALYSIS API
// ----------------------------------------------------------------------------

/**
 * Analyzes an SMS/WhatsApp text message for phishing links, fake TRAI DLT headers,
 * and psychological urgency coercion lures.
 *
 * @param text The body text of the SMS message.
 * @param sender Optional sender header (e.g. "VM-HDFCBK" or "+919876543210").
 */
export const analyzeMessageApi = async (
  text?: string,
  sender?: string
): Promise<SmishingAnalysis> => {
  const { body } = await requestJson<SmishingAnalysis>('/api/message/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text || '', sender: sender || '' }),
  });
  return body;
};

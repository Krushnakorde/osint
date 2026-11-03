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
}

/** Authentication response containing the signed JWT and the user profile */
export interface AuthResponse {
  token: string;
  user: User;
}

/** Local storage key used to persist the stateless JWT across browser reloads */
const TOKEN_KEY = 'osint_jwt_token';

/** In-memory cache of the active JWT token */
let authToken: string | null =
  typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;

/** Retrieves the current active JWT token */
export const getAuthToken = (): string | null => authToken;

/**
 * Sets or clears the active JWT in memory and persists it to browser LocalStorage.
 * Passing `null` removes the token (used during logout).
 */
export const setAuthToken = (token: string | null): void => {
  authToken = token;
  if (typeof localStorage !== 'undefined') {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  }
};

/** Possible body responses returned by the investigation search endpoint */
export type SearchBody = Investigation | NotFound | { error: string };

/**
 * Core HTTP fetch wrapper.
 * Automatically injects the JWT Bearer authorization header if a session exists.
 * Gracefully parses JSON responses without throwing unhandled syntax errors.
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

/** Authenticates user with email and password, obtaining a signed JWT */
export const login = (email: string, password: string) =>
  requestJson<AuthResponse>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

/** Registers a new account and immediately receives a signed JWT */
export const register = (email: string, password: string, name: string) =>
  requestJson<AuthResponse>('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });

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
 * Terminates user session: notifies backend to add token JTI to revocation list,
 * and clears the token from browser LocalStorage.
 */
export const logout = async () => {
  try {
    await requestJson('/api/auth/logout', { method: 'POST' });
  } finally {
    setAuthToken(null);
  }
};

/**
 * Verifies active session on initial page load.
 * Returns the User object if token is valid, or null if expired/invalid.
 */
export const ensureSession = async (): Promise<User | null> => {
  if (authToken) {
    try {
      const me = await getMe();
      if (me.status === 200 && me.body?.user) return me.body.user;
    } catch {
      // Network failure or invalid session
    }
    // Token is expired or revoked: purge it
    setAuthToken(null);
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
  text: string,
  sender?: string
): Promise<SmishingAnalysis> => {
  const { body } = await requestJson<SmishingAnalysis>('/api/message/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, sender }),
  });
  return body;
};

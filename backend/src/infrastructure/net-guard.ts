import { config } from '../config.ts';

/** Minimum gap between requests to one host (politeness / public rate limits). */
const INTERVAL_MS: Record<string, number> = { 'dns.google': 100, 'cloudflare-dns.com': 100, 'raw.githubusercontent.com': 0, 'openphish.com': 0 };
let defaultIntervalMs = 1100;
/** Test helper: remove the politeness delay. */
export const setDefaultIntervalMs = (ms: number): void => { defaultIntervalMs = ms; };
const nextSlot = new Map<string, number>();

export function isAllowedHost(host: string, allowed: string[] = config.allowedHosts, patterns: RegExp[] = config.allowedHostPatterns): boolean {
  return allowed.includes(host) || patterns.some((p) => p.test(host));
}
export function isAllowedUrl(url: string, allowed: string[] = config.allowedHosts, patterns: RegExp[] = config.allowedHostPatterns): boolean {
  try { return isAllowedHost(new URL(url).hostname, allowed, patterns); } catch { return false; }
}

export interface SafeFetchOptions { headers?: Record<string, string>; timeoutMs?: number; allowed?: string[]; patterns?: RegExp[] }

/**
 * Every HTTP request in this project goes through here.
 * Passive-only by construction: hosts outside the allow-list are refused (including every redirect hop),
 * so the system cannot send a single packet to a suspected fraud target.
 */
export async function safeFetch(url: string, { headers = {}, timeoutMs = 15000, allowed = config.allowedHosts, patterns = config.allowedHostPatterns }: SafeFetchOptions = {}): Promise<Response> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    if (!isAllowedUrl(current, allowed, patterns)) throw new Error(`Blocked by passive-only guard: ${current}`);
    const host = new URL(current).hostname;
    const gap = INTERVAL_MS[host] ?? defaultIntervalMs;
    const slot = Math.max(Date.now(), nextSlot.get(host) ?? 0); // reserve synchronously so concurrent callers queue up
    nextSlot.set(host, slot + gap);
    if (slot > Date.now()) await new Promise((r) => setTimeout(r, slot - Date.now()));
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(current, { redirect: 'manual', headers: { 'User-Agent': 'osint-fraud-research/1.0 (academic)', ...headers }, signal: ctrl.signal });
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) { current = new URL(loc, current).toString(); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${host}`);
      return res;
    } finally { clearTimeout(t); }
  }
  throw new Error('Too many redirects');
}

export const getJson = async <T>(url: string, opts?: SafeFetchOptions): Promise<T> => (await safeFetch(url, opts)).json() as Promise<T>;
export const getText = async (url: string, opts?: SafeFetchOptions): Promise<string> => (await safeFetch(url, opts)).text();

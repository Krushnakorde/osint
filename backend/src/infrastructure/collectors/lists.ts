import { getJson, getText } from '../net-guard.ts';
import type { Collector } from './types.ts';

// Public blocklists / phishing feeds. They are LABELS only (never used as correlation evidence).
interface ListDef { name: string; load: () => Promise<Set<string>> }
interface ListState { def: ListDef; domains: Set<string> | null; loadedAt: number; loading: Promise<void> | null }

const hostOf = (u: string): string | null => { try { return new URL(u.trim()).hostname.toLowerCase(); } catch { return null; } };

export const DEFS: ListDef[] = [
  { name: 'metamask-blocklist', load: async () => {
      const j = await getJson<{ blacklist?: string[] }>('https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/master/src/config.json', { timeoutMs: 60000 });
      return new Set((j.blacklist ?? []).map((d) => d.toLowerCase()));
    } },
  { name: 'openphish', load: async () => {
      const t = await getText('https://openphish.com/feed.txt', { timeoutMs: 60000 });
      return new Set(t.split(/\r?\n/).map(hostOf).filter((h): h is string => !!h));
    } },
];
const TTL_MS = 12 * 3600_000;
const state = new Map<string, ListState>(DEFS.map((d) => [d.name, { def: d, domains: null, loadedAt: 0, loading: null }]));

function ensure(s: ListState): Promise<void> {
  if (s.domains && Date.now() - s.loadedAt < TTL_MS) return Promise.resolve();
  if (!s.loading) {
    s.loading = s.def.load()
      .then((d) => { s.domains = d; s.loadedAt = Date.now(); })
      .catch((e: Error) => console.warn(`[lists] ${s.def.name}: ${e.message}`))
      .finally(() => { s.loading = null; });
  }
  return s.loading;
}
export const warmLists = (): Promise<void[]> => Promise.all([...state.values()].map(ensure));
export const listStatus = (): Record<string, number | null> => Object.fromEntries([...state].map(([n, s]) => [n, s.domains?.size ?? null]));
export const openphishHosts = (): string[] => [...(state.get('openphish')?.domains ?? [])];
/** Test helper: pretend a list was loaded. */
export function setListForTests(name: string, domains: string[]): void { const s = state.get(name); if (s) { s.domains = new Set(domains); s.loadedAt = Date.now(); } }

function parents(domain: string): string[] {
  const p = domain.split('.'); const out: string[] = [];
  for (let i = 0; i < p.length - 1; i++) out.push(p.slice(i).join('.'));
  return out;
}
export function listedIn(domain: string): string[] {
  const ps = parents(domain);
  return [...state].filter(([, s]) => s.domains && ps.some((d) => s.domains?.has(d))).map(([n]) => n);
}

export const blocklists: Collector = {
  name: 'blocklists', kinds: ['domain'],
  async run({ value }) {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      warmLists(),
      new Promise((r) => { timer = setTimeout(r, 8000); timer.unref?.(); }),
    ]).finally(() => { if (timer) clearTimeout(timer); });
    const loaded = [...state.values()].filter((s) => s.domains).length;
    const hits = listedIn(value);
    return { obs: { domain: value, blocklists: hits }, exists: hits.length > 0, note: loaded < state.size ? `${loaded}/${state.size} lists loaded so far` : undefined };
  },
};

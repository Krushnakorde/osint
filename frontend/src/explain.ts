// Turns the engine's technical output into plain-language text keys. Pure functions (no React), unit-tested.
import type { LinkEvidence } from './types.ts';

export type Evidence = LinkEvidence['evidence'][number];

export const shorten = (v: string, n = 26): string => (v.length > n ? `${v.slice(0, n - 1)}…` : v);
export const valueOf = (id: string): string => (id.includes(':') ? id.slice(id.indexOf(':') + 1) : id);
export const capitalize = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

const DIRECT = new Set(['solicits', 'distributed_from', 'embeds_wallet', 'co_spent', 'funded_by']);
const SHARED = new Set(['cert', 'ip', 'nameserver', 'tracker', 'signer', 'package', 'wallet', 'apk', 'brand', 'report', 'registrar', 'asn', 'domain', 'email', 'phone']);

/** One piece of evidence -> a sentence key + parameters. */
export function connectionText(e: Evidence): { key: string; params: Record<string, string> } {
  const value = shorten(valueOf(e.via));
  if (e.via.startsWith('direct:')) {
    const rel = e.via.slice('direct:'.length);
    return { key: DIRECT.has(rel) ? `why.direct.${rel}` : 'why.direct.other', params: { value } };
  }
  return { key: SHARED.has(e.type) ? `why.${e.type}` : 'why.generic', params: { value } };
}

export type StrengthKey = 'conn.strength.strong' | 'conn.strength.moderate' | 'conn.strength.possible';
export const strengthKey = (score: number): StrengthKey =>
  score >= 0.85 ? 'conn.strength.strong' : score >= 0.7 ? 'conn.strength.moderate' : 'conn.strength.possible';

export const daysSince = (iso: string, now = Date.now()): number => Math.max(0, Math.floor((now - Date.parse(iso)) / 86_400_000));

/** Escape text before it goes into the graph library's tooltips (which render HTML). Values come from untrusted public data. */
export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));

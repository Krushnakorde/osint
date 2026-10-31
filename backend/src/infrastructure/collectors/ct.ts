import { getJson } from '../net-guard.ts';
import type { Observation } from '../../domain/types.ts';
import type { Collector } from './types.ts';

interface CrtRow { name_value?: string; issuer_ca_id: number; serial_number: string }
export const certId = (r: CrtRow): string => `${r.issuer_ca_id}-${r.serial_number}`;
const names = (r: CrtRow): string[] => String(r.name_value ?? '').toLowerCase().split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('*'));

/** Certificate Transparency via crt.sh (public log aggregator; the target is never contacted). */
export const ctDomain: Collector = {
  name: 'crt.sh', kinds: ['domain'],
  async run({ value }) {
    const rows = await getJson<CrtRow[]>(`https://crt.sh/?q=${encodeURIComponent(value)}&output=json`, { timeoutMs: 30000 });
    const certs = new Set<string>(); const sans = new Set<string>();
    for (const r of rows) {
      const n = names(r);
      if (!n.includes(value)) continue;
      certs.add(certId(r));
      for (const x of n) if (x !== value) sans.add(x);
    }
    return { obs: { domain: value, certs: [...certs].slice(0, 20), sans: [...sans].slice(0, 50) }, exists: certs.size > 0 };
  },
};

/** A 64-hex string may be a TLS certificate fingerprint: ask CT which domains it covers. */
export const ctFingerprint: Collector = {
  name: 'crt.sh (fingerprint)', kinds: ['sha256'],
  async run({ value }) {
    const rows = await getJson<CrtRow[]>(`https://crt.sh/?q=${encodeURIComponent(value)}&output=json`, { timeoutMs: 30000 });
    const extra: Observation[] = [];
    const seen = new Set<string>();
    for (const r of rows) for (const d of names(r)) {
      if (seen.has(d) || seen.size >= 30) continue;
      seen.add(d);
      extra.push({ source: 'pivot:crt.sh', domain: d, certs: [certId(r)], sans: names(r).filter((x) => x !== d).slice(0, 20) });
    }
    return { extra, exists: extra.length > 0, note: extra.length ? 'matched a TLS certificate fingerprint' : undefined };
  },
};

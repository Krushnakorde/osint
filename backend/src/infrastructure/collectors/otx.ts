import { getJson } from '../net-guard.ts';
import type { IpInput, Observation } from '../../domain/types.ts';
import type { Collector } from './types.ts';

interface Pulse { id: string; name?: string; indicator_count?: number }
interface General { pulse_info?: { count?: number; pulses?: Pulse[] } }
interface Pdns { passive_dns?: Array<{ address?: string; hostname?: string; record_type?: string }> }
const BASE = 'https://otx.alienvault.com/api/v1/indicators';

/** AlienVault OTX (public threat-report platform): reports mentioning the domain + passive DNS history. */
export const otxDomain: Collector = {
  name: 'alienvault-otx', kinds: ['domain'],
  async run({ value }) {
    const g = await getJson<General>(`${BASE}/domain/${encodeURIComponent(value)}/general`);
    // Narrow reports (<=100 indicators) identify a campaign; huge "weekly dump" pulses would link unrelated domains.
    const reports = (g.pulse_info?.pulses ?? []).filter((p) => (p.indicator_count ?? Infinity) <= 100).slice(0, 5).map((p) => `otx:${p.id}`);
    let ips: IpInput[] = [];
    try {
      const p = await getJson<Pdns>(`${BASE}/domain/${encodeURIComponent(value)}/passive_dns`);
      ips = [...new Set((p.passive_dns ?? []).filter((r) => r.record_type === 'A' && r.address).map((r) => r.address as string))].slice(0, 5).map((ip) => ({ ip, weight: 0.7 }));
    } catch { /* passive DNS is optional */ }
    const exists = (g.pulse_info?.count ?? 0) > 0 || ips.length > 0;
    return { obs: { domain: value, reports, ips }, exists, note: g.pulse_info?.count ? `${g.pulse_info.count} threat report(s) mention it` : undefined };
  },
};

export const otxIp: Collector = {
  name: 'alienvault-otx', kinds: ['ip'],
  async run({ value }) {
    const p = await getJson<Pdns>(`${BASE}/IPv4/${encodeURIComponent(value)}/passive_dns`);
    const seen = new Set<string>(); const extra: Observation[] = [];
    for (const r of p.passive_dns ?? []) {
      const d = r.hostname?.toLowerCase();
      if (d && !seen.has(d) && seen.size < 25) { seen.add(d); extra.push({ source: 'pivot:otx', domain: d, ips: [{ ip: value, weight: 0.7 }] }); }
    }
    return { extra, exists: extra.length > 0 };
  },
};

import { getJson } from '../net-guard.ts';
import { normAsn } from '../../domain/normalize.ts';
import type { IpInput, Observation } from '../../domain/types.ts';
import type { Collector, LookupCtx } from './types.ts';

interface Hit { page?: { ip?: string; asn?: string; domain?: string; server?: string } }
interface Search { results?: Hit[]; total?: number }

const headers = (ctx: LookupCtx): Record<string, string> => (ctx.cfg.urlscanKey ? { 'API-Key': ctx.cfg.urlscanKey } : {});
const search = (q: string, size: number, ctx: LookupCtx): Promise<Search> =>
  getJson<Search>(`https://urlscan.io/api/v1/search/?q=${encodeURIComponent(q)}&size=${size}`, { headers: headers(ctx) });

/** Existing public scans of the domain by other people (we never submit a scan). Gives IP/ASN and co-hosted domains. */
export const urlscanDomain: Collector = {
  name: 'urlscan.io', kinds: ['domain'],
  async run(ctx) {
    const { value, cfg } = ctx;
    const res = await search(`domain:${value}`, 20, ctx);
    const ips = new Map<string, IpInput>();
    for (const h of res.results ?? []) {
      const ip = h.page?.ip;
      if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip) && ips.size < 4) ips.set(ip, { ip, asn: h.page?.asn ? normAsn(h.page.asn) : null, weight: 0.8 });
    }
    const extra: Observation[] = [];
    const first = [...ips.keys()][0];
    if (first && cfg.maxPivotDomains > 0) {
      const sib = await search(`page.ip:"${first}"`, 30, ctx);
      if ((sib.total ?? 0) < 100) { // 100+ domains on one IP = shared hosting/CDN: not a useful pivot
        const seen = new Set<string>([value]);
        for (const h of sib.results ?? []) {
          const d = h.page?.domain?.toLowerCase();
          if (d && !seen.has(d) && seen.size <= cfg.maxPivotDomains) { seen.add(d); extra.push({ source: 'pivot:urlscan', domain: d, ips: [{ ip: first, asn: h.page?.asn ? normAsn(h.page.asn) : null, weight: 0.8 }] }); }
        }
      }
    }
    return { obs: { domain: value, ips: [...ips.values()] }, extra, exists: ips.size > 0 };
  },
};

/** Domains that other people's scans saw on this IP. */
export const urlscanIp: Collector = {
  name: 'urlscan.io', kinds: ['ip'],
  async run(ctx) {
    const res = await search(`page.ip:"${ctx.value}"`, 40, ctx);
    const seen = new Set<string>(); const extra: Observation[] = [];
    for (const h of res.results ?? []) {
      const d = h.page?.domain?.toLowerCase();
      if (d && !seen.has(d) && seen.size < 25) { seen.add(d); extra.push({ source: 'pivot:urlscan', domain: d, ips: [{ ip: ctx.value, asn: h.page?.asn ? normAsn(h.page.asn) : null, weight: 0.8 }] }); }
    }
    return { extra, exists: extra.length > 0, note: (res.total ?? 0) >= 100 ? 'shared hosting/CDN IP: many unrelated domains' : undefined };
  },
};

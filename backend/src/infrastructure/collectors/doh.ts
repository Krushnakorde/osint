import { getJson } from '../net-guard.ts';
import { registrableDomain } from '../../domain/normalize.ts';
import type { IpInput } from '../../domain/types.ts';
import type { Collector } from './types.ts';

// DNS over HTTPS through public resolvers. The resolver (not this machine) asks the domain's
// authoritative nameserver, so no packet from this system ever reaches the target's own servers.
const TYPES = { A: 1, NS: 2, CNAME: 5, TXT: 16, AAAA: 28 } as const;
export type DnsType = keyof typeof TYPES;
interface DohAnswer { name: string; type: number; data: string }
interface DohResponse { Status: number; Answer?: DohAnswer[] }

export function parseAnswers(res: DohResponse, type: DnsType): string[] {
  return (res.Answer ?? []).filter((a) => a.type === TYPES[type]).map((a) =>
    type === 'TXT' ? a.data.replace(/^"|"$/g, '').replace(/"\s*"/g, '') : a.data.replace(/\.$/, '').toLowerCase());
}

const ENDPOINTS: Array<(name: string, type: DnsType) => string> = [
  (n, t) => `https://dns.google/resolve?name=${encodeURIComponent(n)}&type=${t}`,
  (n, t) => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(n)}&type=${t}`,
];

export async function dohQuery(name: string, type: DnsType): Promise<string[]> {
  let lastError: unknown = null;
  for (const url of ENDPOINTS) {
    try {
      const res = await getJson<DohResponse>(url(name, type), { headers: { accept: 'application/dns-json' } });
      if (res.Status === 0 || res.Status === 3) return parseAnswers(res, type); // 3 = NXDOMAIN
    } catch (e) { lastError = e; /* try the next resolver */ }
  }
  if (lastError) throw lastError instanceof Error ? lastError : new Error('DNS-over-HTTPS resolvers unreachable');
  return [];
}

/** "13335 | 1.1.1.0/24 | AU | apnic | 2011-08-11"  ->  "13335" */
export const parseCymruOrigin = (txt: string): string | null => txt.split('|')[0]?.trim().split(/\s+/)[0] || null;

const asnCache = new Map<string, string | null>();
/** IPv4 -> origin ASN via Team Cymru's public DNS mapping service (queried over DoH). */
export async function asnForIp(ip: string): Promise<string | null> {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return null;
  if (asnCache.has(ip)) return asnCache.get(ip) ?? null;
  let asn: string | null = null;
  try {
    const [txt] = await dohQuery(`${ip.split('.').reverse().join('.')}.origin.asn.cymru.com`, 'TXT');
    asn = txt ? parseCymruOrigin(txt) : null;
  } catch { return null; } // do not cache failures
  asnCache.set(ip, asn);
  return asn;
}

export const dohDomain: Collector = {
  name: 'dns-over-https', kinds: ['domain'], enabled: (c) => c.allowDoh,
  async run({ value }) {
    const a = (await dohQuery(value, 'A')).filter((x) => /^\d+\.\d+\.\d+\.\d+$/.test(x));
    const ns = await dohQuery(registrableDomain(value), 'NS').catch((): string[] => []);
    const ips: IpInput[] = [];
    for (const ip of a.slice(0, 4)) ips.push({ ip, asn: await asnForIp(ip) });
    return { obs: { domain: value, ips, nameservers: ns }, exists: ips.length > 0 || ns.length > 0 };
  },
};

export const asnIp: Collector = {
  name: 'asn-lookup', kinds: ['ip'], enabled: (c) => c.allowDoh,
  async run({ value }) {
    const asn = await asnForIp(value);
    return { obs: { ips: [{ ip: value, asn }] }, exists: !!asn };
  },
};

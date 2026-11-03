/**
 * ============================================================================
 * MODULE: DNS-over-HTTPS (DoH) & Autonomous System Number (ASN) Collector
 * FILE: backend/src/infrastructure/collectors/doh.ts
 * ============================================================================
 *
 * WHAT THIS FILE DOES:
 * -------------------
 * This module performs passive network intelligence gathering on suspicious domain
 * names and IP addresses using DNS-over-HTTPS (RFC 8484) and Team Cymru's IP-to-ASN
 * DNS mapping service.
 *
 * WHY THIS IS CRITICAL FOR OSINT & CYBERSECURITY INVESTIGATIONS:
 * -------------------------------------------------------------
 * 1. Passive / Stealthy Reconnaissance:
 *    When investigating a phishing site (e.g., "secure-sbi-login.xyz"), traditional
 *    DNS queries or direct HTTP requests could alert the scammer or hit their honey-tokens/logs.
 *    By using public recursive DoH resolvers (Google DNS 8.8.8.8 and Cloudflare 1.1.1.1),
 *    the resolver itself queries the authoritative nameservers on our behalf. Our server's
 *    IP address NEVER touches the scammer's servers, preserving total operational security.
 *
 * 2. Encrypted Transport (RFC 8484):
 *    All DNS queries travel inside HTTPS (port 443) encrypted tunnels, preventing local ISP
 *    eavesdropping, DNS spoofing, or man-in-the-middle manipulation of records.
 *
 * 3. Autonomous System Number (ASN) Attribution:
 *    An ASN identifies which hosting provider, data center, or telco owns an IP address
 *    (e.g., Cloudflare ASN 13335, DigitalOcean ASN 14061, Hostinger ASN 47583). Scammers
 *    often cycle IPs within the same bulletproof hoster. Team Cymru allows us to resolve
 *    IPs to ASNs via standard reverse-DNS TXT lookups without subscribing to paid databases.
 * ============================================================================
 */

import { getJson } from '../net-guard.ts';
import { registrableDomain } from '../../domain/normalize.ts';
import type { IpInput } from '../../domain/types.ts';
import type { Collector } from './types.ts';

/**
 * Standard IANA DNS Resource Record (RR) Type Codes.
 * - A (1): IPv4 address record (e.g., "192.0.2.1").
 * - NS (2): Authoritative Name Server record (e.g., "ns1.hosting.com").
 * - CNAME (5): Canonical Name / Alias record.
 * - TXT (16): Text strings (used for SPF, verification, Cymru ASN lookups).
 * - AAAA (28): IPv6 address record.
 */
const TYPES = { A: 1, NS: 2, CNAME: 5, TXT: 16, AAAA: 28 } as const;
export type DnsType = keyof typeof TYPES;

/** Schema of an individual Answer object returned by standard DoH JSON APIs. */
interface DohAnswer {
  name: string;
  type: number;
  data: string;
}

/** Root schema returned by Google and Cloudflare DNS-over-HTTPS JSON endpoints. */
interface DohResponse {
  Status: number;        // 0 = NOERROR (Success), 3 = NXDOMAIN (Domain does not exist)
  Answer?: DohAnswer[];  // Array of DNS answer records
}

/**
 * Extracts and cleans DNS record values from a DoH response object.
 *
 * @param res The raw JSON response from Google or Cloudflare DoH.
 * @param type The DNS record type we queried (e.g., 'A', 'NS', 'TXT').
 * @returns An array of sanitized string answers.
 *
 * Educational Details:
 * - TXT records often arrive wrapped in double quotes: `"13335 | 1.1.1.0/24 | ..."`
 *   We strip these outer quotes and concatenate multi-segment chunked strings.
 * - Hostnames (like nameservers) often arrive with a trailing root dot: `"ns1.domain.com."`
 *   We strip the trailing dot and convert to lowercase for consistent graph matching.
 */
export function parseAnswers(res: DohResponse, type: DnsType): string[] {
  return (res.Answer ?? [])
    .filter((a) => a.type === TYPES[type])
    .map((a) =>
      type === 'TXT'
        ? a.data.replace(/^"|"$/g, '').replace(/"\s*"/g, '')
        : a.data.replace(/\.$/, '').toLowerCase()
    );
}

/**
 * Failover list of public DNS-over-HTTPS JSON API endpoints.
 * - Google Public DNS: https://dns.google
 * - Cloudflare 1.1.1.1: https://cloudflare-dns.com
 * If one provider is unreachable or throttled, we automatically fall back to the next.
 */
const ENDPOINTS: Array<(name: string, type: DnsType) => string> = [
  (n, t) => `https://dns.google/resolve?name=${encodeURIComponent(n)}&type=${t}`,
  (n, t) => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(n)}&type=${t}`,
];

/**
 * Executes a DNS query over HTTPS with automatic resolver failover.
 *
 * @param name The hostname or domain to query (e.g., "example.com").
 * @param type The DNS record type (e.g., 'A', 'NS', 'TXT').
 * @returns Array of answers, or empty array if domain does not exist (NXDOMAIN).
 */
export async function dohQuery(name: string, type: DnsType): Promise<string[]> {
  let lastError: unknown = null;

  // Try each public resolver in sequence
  for (const url of ENDPOINTS) {
    try {
      // NetGuard ensures outbound connection passes SSRF firewall and politeness checks
      const res = await getJson<DohResponse>(url(name, type), {
        headers: { accept: 'application/dns-json' },
      });

      // Status 0: NOERROR (Query successful)
      // Status 3: NXDOMAIN (Non-Existent Domain - valid negative response)
      if (res.Status === 0 || res.Status === 3) {
        return parseAnswers(res, type);
      }
    } catch (e) {
      lastError = e; // Resolver timed out or failed; try the backup resolver
    }
  }

  if (lastError) {
    throw lastError instanceof Error
      ? lastError
      : new Error('DNS-over-HTTPS resolvers unreachable');
  }
  return [];
}

/**
 * Parses Team Cymru's DNS origin TXT response.
 *
 * Example input string from Cymru:
 *   "13335 | 1.1.1.0/24 | AU | apnic | 2011-08-11"
 * Output:
 *   "13335" (the Autonomous System Number for Cloudflare)
 */
export const parseCymruOrigin = (txt: string): string | null =>
  txt.split('|')[0]?.trim().split(/\s+/)[0] || null;

/**
 * In-memory cache for IP -> ASN mappings.
 * IP addresses rarely change their hosting ASN within a short investigation session.
 * Caching saves network latency and respects Team Cymru's free query policy.
 */
const asnCache = new Map<string, string | null>();

/**
 * Resolves an IPv4 address to its Autonomous System Number (ASN) via Team Cymru.
 *
 * How it works (RFC-style Reverse DNS query):
 * 1. Takes an IP like "1.1.1.1".
 * 2. Reverses the octets: "1.1.1.1" -> "1.1.1.1".
 *    For "192.0.2.42" -> "42.2.0.192".
 * 3. Appends Cymru's DNS zone: "42.2.0.192.origin.asn.cymru.com".
 * 4. Queries the TXT record over DoH.
 * 5. Parses the returned ASN string.
 */
export async function asnForIp(ip: string): Promise<string | null> {
  // Validate standard IPv4 format
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return null;

  // Check cache first
  if (asnCache.has(ip)) return asnCache.get(ip) ?? null;

  let asn: string | null = null;
  try {
    const reversedIp = ip.split('.').reverse().join('.');
    const [txt] = await dohQuery(`${reversedIp}.origin.asn.cymru.com`, 'TXT');
    asn = txt ? parseCymruOrigin(txt) : null;
  } catch {
    return null; // Do not cache network failures so subsequent attempts can retry
  }

  asnCache.set(ip, asn);
  return asn;
}

/**
 * Domain Collector:
 * Ingests domain names into the intelligence graph by resolving:
 * - A records (up to 4 IPv4 addresses)
 * - Origin ASNs for each IP
 * - Authoritative Nameservers (NS records) of the parent registrable domain
 */
export const dohDomain: Collector = {
  name: 'dns-over-https',
  kinds: ['domain'],
  enabled: (c) => c.allowDoh,
  async run({ value }) {
    // 1. Resolve IPv4 addresses
    const a = (await dohQuery(value, 'A')).filter((x) => /^\d+\.\d+\.\d+\.\d+$/.test(x));

    // 2. Resolve Nameservers on the registrable apex domain (e.g. "bank-login.xyz")
    const ns = await dohQuery(registrableDomain(value), 'NS').catch((): string[] => []);

    // 3. Enrich top 4 IPs with their respective hosting ASNs
    const ips: IpInput[] = [];
    for (const ip of a.slice(0, 4)) {
      ips.push({ ip, asn: await asnForIp(ip) });
    }

    return {
      obs: { domain: value, ips, nameservers: ns },
      exists: ips.length > 0 || ns.length > 0,
    };
  },
};

/**
 * IP Address Collector:
 * Ingests standalone IP addresses into the graph and tags them with their hosting ASN.
 */
export const asnIp: Collector = {
  name: 'asn-lookup',
  kinds: ['ip'],
  enabled: (c) => c.allowDoh,
  async run({ value }) {
    const asn = await asnForIp(value);
    return {
      obs: { ips: [{ ip: value, asn }] },
      exists: !!asn,
    };
  },
};

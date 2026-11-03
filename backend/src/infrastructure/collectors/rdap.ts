/**
 * ============================================================================
 * MODULE: RDAP (Registration Data Access Protocol) Domain Collector
 * FILE: backend/src/infrastructure/collectors/rdap.ts
 * ============================================================================
 *
 * WHAT THIS FILE DOES:
 * -------------------
 * This module queries public domain registration data using the modern, RFC-standardized
 * RDAP protocol (RFC 7480, 7481, 7482, 7483, 7484).
 *
 * WHY RDAP INSTEAD OF LEGACY WHOIS:
 * ---------------------------------
 * 1. Structured JSON vs. Raw Text:
 *    Legacy WHOIS runs over TCP port 43 and returns arbitrary, unstructured plain text
 *    differing across thousands of domain registries. RDAP delivers predictable,
 *    machine-readable JSON over HTTPS (RESTful API).
 *
 * 2. Standardized Entities & jCard (RFC 7095):
 *    Registrar names, technical contacts, and privacy guards are formatted uniformly
 *    inside standardized `vcardArray` structures.
 *
 * 3. Passive & Safe:
 *    We query public ICANN bootstrap aggregators (`rdap.org`), which forward to the
 *    responsible top-level registry (e.g., Verisign for .com, PIR for .org).
 *    The scammer's own web server is NEVER contacted.
 *
 * 4. Fraud Detection Signals:
 *    - Domain Age: Newly registered domains (<30 days old) impersonating banks are high-risk.
 *    - Registrar: Fraud syndicates frequently register bulk domains through specific registrars
 *      known for lax KYC (e.g. Namecheap, NiceNIC, Porkbun).
 *    - Nameservers: Scammers frequently reuse bulletproof DNS infrastructure across campaigns.
 * ============================================================================
 */

import { getJson } from '../net-guard.ts';
import { registrableDomain } from '../../domain/normalize.ts';
import type { Collector } from './types.ts';

/**
 * Representation of an RDAP entity (registrar, registrant, administrative contact).
 * Follows the jCard format (RFC 7095) where vcard properties are nested arrays.
 */
interface RdapEntity {
  roles?: string[];
  vcardArray?: [string, Array<[string, unknown, string, unknown]>];
}

/** Root RDAP response schema conforming to RFC 7483. */
export interface Rdap {
  entities?: RdapEntity[];
  nameservers?: Array<{ ldhName?: string }>; // LDH = Letters, Digits, Hyphen
  events?: Array<{ eventAction?: string; eventDate?: string }>;
}

/**
 * Parses raw RDAP JSON into structured registration facts needed for graph correlation.
 *
 * @param j The raw RDAP JSON response object.
 * @returns Cleaned registrar name, nameserver hostnames, and registration ISO date.
 */
export function parseRdap(j: Rdap): {
  registrar?: string;
  nameservers: string[];
  registered?: string;
} {
  // 1. Extract Registrar Name
  // Locate the entity whose role array contains "registrar"
  const reg = (j.entities ?? []).find((e) => e.roles?.includes('registrar'));
  // In jCard JSON format: vcardArray[1] contains rows: ['fn', {}, 'text', 'Registrar Name LLC']
  const fn = reg?.vcardArray?.[1]?.find((x) => x[0] === 'fn')?.[3];

  // 2. Extract Nameservers
  // Lowercase and filter out any blank or missing hostnames
  const nameservers = (j.nameservers ?? [])
    .map((n) => (n.ldhName ?? '').toLowerCase())
    .filter(Boolean);

  // 3. Extract Registration Date
  // Locate the lifecycle event where eventAction is "registration"
  const registered = j.events?.find((e) => e.eventAction === 'registration')?.eventDate;

  return {
    registrar: typeof fn === 'string' ? fn : undefined,
    nameservers,
    registered,
  };
}

/**
 * RDAP Domain Collector:
 * Ingests domain registration intelligence into the graph.
 * Fetches data from rdap.org bootstrap redirector for the base registrable domain.
 */
export const rdap: Collector = {
  name: 'rdap',
  kinds: ['domain'],
  async run({ value }) {
    // Query the apex domain (e.g. "phish.example.co.uk" -> "example.co.uk")
    const apex = registrableDomain(value);
    const j = await getJson<Rdap>(`https://rdap.org/domain/${encodeURIComponent(apex)}`);
    const r = parseRdap(j);

    return {
      obs: {
        domain: value,
        registrar: r.registrar,
        nameservers: r.nameservers,
        registered: r.registered,
      },
      exists: !!(r.registrar || r.registered),
    };
  },
};

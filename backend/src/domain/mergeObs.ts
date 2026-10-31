import type { IpInput, Observation } from './types.ts';

const dedupe = <T>(arr: T[], key: (x: T) => string): T[] => [...new Map(arr.map((x) => [key(x), x])).values()];

/** Merge facts about the SAME indicator that came from different sources. */
export function mergeObs(a: Observation, b: Observation): Observation {
  const ips = new Map<string, IpInput>();
  for (const x of [...(a.ips ?? []), ...(b.ips ?? [])]) {
    const o = typeof x === 'string' ? { ip: x } : x;
    const prev = ips.get(o.ip);
    ips.set(o.ip, { ...prev, ...o, asn: o.asn ?? prev?.asn, weight: Math.max(o.weight ?? 0, prev?.weight ?? 0) || undefined });
  }
  const cat = <T>(x?: T[], y?: T[]): T[] | undefined => { const r = dedupe([...(x ?? []), ...(y ?? [])], (v) => JSON.stringify(v)); return r.length ? r : undefined; };
  return {
    ...a, ...b,
    domain: a.domain ?? b.domain, registrar: a.registrar ?? b.registrar, registered: a.registered ?? b.registered,
    ips: ips.size ? [...ips.values()] : undefined,
    certs: cat(a.certs, b.certs), sans: cat(a.sans, b.sans), nameservers: cat(a.nameservers, b.nameservers),
    trackers: cat(a.trackers, b.trackers), wallets: cat(a.wallets, b.wallets), wallet_links: cat(a.wallet_links, b.wallet_links),
    emails: cat(a.emails, b.emails), phones: cat(a.phones, b.phones),
    reports: cat(a.reports, b.reports), blocklists: cat(a.blocklists, b.blocklists), apk: a.apk ?? b.apk,
  };
}

export const obsHasData = (o?: Observation): boolean => !!o && !!(
  o.ips?.length || o.certs?.length || o.sans?.length || o.nameservers?.length || o.registrar || o.registered ||
  o.wallet_links?.length || o.blocklists?.length || o.reports?.length || o.apk?.package || o.apk?.signer_sha256 ||
  o.emails?.length || o.phones?.length);

// Synthetic, reproducible multi-vector fraud dataset WITH ground truth (campaign labels).
// It exists so the pipeline and the evaluation harness run offline out of the box.
// It is NOT a substitute for the real, de-anonymised dataset your thesis needs (README section 10.3).
import { nodeId } from './normalize.ts';
import type { AssetType, IpInput, Observation } from './types.ts';

export interface Dataset { observations: Observation[]; truth: Record<string, string> }
export interface DatasetOptions { campaigns?: number; noise?: number; seed?: number }

function mulberry32(a: number): () => number {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateDataset({ campaigns = 40, noise = 150, seed = 42 }: DatasetOptions = {}): Dataset {
  const rnd = mulberry32(seed);
  const int = (a: number, b: number): number => a + Math.floor(rnd() * (b - a + 1));
  const pick = <T>(arr: readonly T[]): T => arr[int(0, arr.length - 1)] as T;
  const hex = (n: number): string => Array.from({ length: n }, () => int(0, 15).toString(16)).join('');
  const brands = ['paypal', 'binance', 'coinbase', 'amazon', 'metamask', 'trustwallet', 'flipkart', 'phonepe'];
  const words = ['secure', 'login', 'verify', 'support', 'wallet', 'claim', 'bonus', 'airdrop', 'account', 'help'];
  const tlds = ['top', 'xyz', 'online', 'shop', 'site', 'click', 'live', 'icu'];
  const asnPool = Array.from({ length: 12 }, (_, i) => `AS${13000 + i * 137}`);
  const nsPool = Array.from({ length: 8 }, (_, i) => `ns1.host${i}.example`);
  const regPool = ['NameCheap Inc', 'GoDaddy', 'Hostinger', 'PDR Ltd', 'Dynadot'];
  const hubIps = Array.from({ length: 5 }, (_, i) => `104.21.${i}.10`);
  const DEBUG_SIGNER = 'a'.repeat(64); // stands in for the shared Android debug certificate
  const used = new Set<string>();
  const observations: Observation[] = [];
  const truth: Record<string, string> = {};
  const label = (type: AssetType, value: string, who: string): void => { truth[nodeId(type, value)] = who; };
  const typoOf = (b: string): string => {
    const m = int(0, 2);
    if (m === 0) return b.replace(/[aeio]/, (c) => ({ a: '4', e: '3', i: '1', o: '0' } as Record<string, string>)[c] ?? c);
    if (m === 1) { const p = int(1, b.length - 1); return b.slice(0, p) + b[p] + b.slice(p); }
    return b;
  };
  const uniqueDomain = (stem: () => string, tldList: readonly string[]): string => {
    let d: string;
    do { d = `${stem()}.${pick(tldList)}`; } while (used.has(d));
    used.add(d);
    return d;
  };

  for (let k = 0; k < campaigns; k++) {
    const who = `campaign-${k}`;
    const brand = pick(brands);
    const infra = {
      ips: Array.from({ length: int(1, 3) }, (): IpInput => ({ ip: `${int(11, 223)}.${int(0, 255)}.${int(0, 255)}.${int(1, 254)}`, asn: pick(asnPool) })),
      ns: rnd() < 0.5 ? `ns.${hex(6)}.example` : pick(nsPool),
      reg: pick(regPool),
      cert: rnd() < 0.55 ? hex(40) : null,
      tracker: rnd() < 0.5 ? `UA-${int(100000, 999999)}-1` : null,
      signer: rnd() < 0.65 ? hex(64) : null,
    };
    const domains = Array.from({ length: int(3, 7) }, () => uniqueDomain(() => `${typoOf(brand)}-${pick(words)}${int(1, 99)}`, tlds));
    const wallets = Array.from({ length: int(1, 3) }, () => `bc1q${hex(38)}`);
    const apks = Array.from({ length: infra.signer ? int(1, 2) : int(0, 1) }, () => hex(64));

    domains.forEach((d, i) => {
      label('domain', d, who);
      observations.push({
        id: `c${k}-d${i}`, source: 'synthetic', domain: d,
        ips: [...infra.ips.filter(() => rnd() < 0.7).slice(0, 2), ...(rnd() < 0.2 ? [{ ip: pick(hubIps), asn: pick(asnPool) }] : [])],
        certs: [infra.cert && rnd() < 0.7 ? infra.cert : hex(40)],
        nameservers: [rnd() < 0.6 ? infra.ns : pick(nsPool)],
        registrar: rnd() < 0.6 ? infra.reg : pick(regPool),
        trackers: infra.tracker && rnd() < 0.6 ? [infra.tracker] : [],
        wallets: rnd() < 0.35 ? [pick(wallets)] : [],
      });
    });
    wallets.forEach((w, i) => {
      label('wallet', w, who);
      observations.push({ id: `c${k}-w${i}`, source: 'synthetic', wallets: [w], ...(rnd() < 0.5 ? { domain: pick(domains) } : {}) });
    });
    apks.forEach((a, i) => {
      label('apk', a, who);
      observations.push({
        id: `c${k}-a${i}`, source: 'synthetic',
        apk: { sha256: a, package: `com.${brand}${k}.app`, signer_sha256: infra.signer || hex(64),
          hosted_on: rnd() < 0.6 ? [pick(domains)] : [], wallets: rnd() < 0.5 ? [pick(wallets)] : [] },
      });
    });
  }

  // Unrelated infrastructure that shares "hub" resources (CDN IPs, popular registrars, debug signing key)
  for (let i = 0; i < noise; i++) {
    const who = `noise-${i}`;
    const stem = rnd() < 0.1 ? () => `${pick(brands)}fans${hex(3)}` : () => `${pick(words)}${hex(5)}`;
    const d = uniqueDomain(stem, ['com', 'net', 'org']);
    label('domain', d, who);
    observations.push({
      id: `n${i}`, source: 'synthetic', domain: d,
      ips: [{ ip: pick(hubIps), asn: pick(asnPool) }], certs: [hex(40)],
      nameservers: [pick(nsPool)], registrar: pick(regPool),
    });
  }
  for (let i = 0; i < Math.max(10, Math.round(noise / 4)); i++) {
    const a = hex(64); label('apk', a, `noise-apk-${i}`);
    observations.push({ id: `na${i}`, source: 'synthetic', apk: { sha256: a, package: `com.app${hex(6)}`, signer_sha256: DEBUG_SIGNER } });
  }
  return { observations, truth };
}

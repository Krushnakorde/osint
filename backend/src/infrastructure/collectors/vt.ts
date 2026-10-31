import { getJson } from '../net-guard.ts';
import type { IpInput } from '../../domain/types.ts';
import type { Collector } from './types.ts';

// Optional: needs VT_API_KEY. GET of EXISTING reports only -- never submits a URL/file for scanning.
interface VtDomain { data?: { attributes?: { registrar?: string; last_analysis_stats?: { malicious?: number }; last_dns_records?: Array<{ type: string; value: string }> } } }
interface VtRes { data?: Array<{ attributes?: { ip_address?: string } }> }
interface VtFile { data?: { attributes?: { androguard?: { Package?: string; Certificate?: { thumbprint?: string; serialnumber?: string } } } } }
const key = (k: string) => ({ headers: { 'x-apikey': k } });

export const vtDomain: Collector = {
  name: 'virustotal', kinds: ['domain'], enabled: (c) => !!c.vtKey,
  async run({ value, cfg }) {
    const base = `https://www.virustotal.com/api/v3/domains/${encodeURIComponent(value)}`;
    const info = await getJson<VtDomain>(base, key(cfg.vtKey));
    const a = info.data?.attributes ?? {};
    const res = await getJson<VtRes>(`${base}/resolutions?limit=10`, key(cfg.vtKey));
    const ips: IpInput[] = (res.data ?? []).map((r) => r.attributes?.ip_address).filter((x): x is string => !!x).slice(0, 5).map((ip) => ({ ip, weight: 0.9 }));
    const malicious = a.last_analysis_stats?.malicious ?? 0;
    return {
      obs: { domain: value, registrar: a.registrar, ips, nameservers: (a.last_dns_records ?? []).filter((r) => r.type === 'NS').map((r) => r.value), blocklists: malicious >= 3 ? ['virustotal'] : [] },
      exists: !!info.data,
    };
  },
};

/** Android package + signing certificate for an APK hash (field names follow VT's androguard section; verify with a real sample). */
export const vtFile: Collector = {
  name: 'virustotal', kinds: ['sha256'], enabled: (c) => !!c.vtKey,
  async run({ value, cfg }) {
    const f = await getJson<VtFile>(`https://www.virustotal.com/api/v3/files/${value}`, key(cfg.vtKey));
    const ag = f.data?.attributes?.androguard;
    if (!ag) return { exists: !!f.data, note: 'known file, but no Android metadata' };
    const signer = (ag.Certificate?.thumbprint ?? ag.Certificate?.serialnumber ?? '').toLowerCase().replace(/[^0-9a-f]/g, '');
    return { obs: { apk: { sha256: value, package: ag.Package, signer_sha256: signer || undefined } }, exists: true };
  },
};

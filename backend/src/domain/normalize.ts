import type { AssetType, NodeType } from './types.ts';

export const ASSET_TYPES: ReadonlySet<string> = new Set<AssetType>(['domain', 'apk', 'wallet', 'email', 'phone']);
export const isAsset = (t: string | undefined): t is AssetType => t !== undefined && ASSET_TYPES.has(t);

export const normDomain = (s: string): string => String(s).trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0]!.replace(/\.$/, '');
export const normHex = (s: string): string => String(s).trim().toLowerCase().replace(/[:\s]/g, '');
export const normWallet = (s: string): string => { const v = String(s).trim(); return v.startsWith('0x') ? v.toLowerCase() : v; };
export const normIp = (s: string): string => String(s).trim();
export const normAsn = (s: string | number): string => String(s).trim().toUpperCase().replace(/^AS/, '');
export const normText = (s: string): string => String(s).trim().toLowerCase();
export const normEmail = (s: string): string => String(s).trim().toLowerCase();
export const normPhone = (s: string): string => {
  const trimmed = String(s).trim();
  if (/^[a-zA-Z]{2}-[a-zA-Z0-9]{5,8}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return `+${digits}`;
  return digits.length === 10 ? `+91${digits}` : `+${digits}`;
};

const NORMALIZERS: Record<NodeType, (s: string) => string> = {
  domain: normDomain, ip: normIp, asn: normAsn, cert: normHex, signer: normHex, apk: normHex,
  wallet: normWallet, package: normText, tracker: (s) => String(s).trim().toUpperCase(),
  registrar: normText, nameserver: normDomain, brand: normText, report: normText, blocklist: normText,
  email: normEmail, phone: normPhone,
};
export const normalize = (type: NodeType, value: string | number): string => NORMALIZERS[type](String(value));
export const nodeId = (type: NodeType, value: string | number): string => `${type}:${normalize(type, value)}`;

const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu']);
/** Registered domain (what RDAP/NS lookups need): evil.example.co.uk -> example.co.uk. Heuristic, no public-suffix list. */
export function registrableDomain(domain: string): string {
  const p = domain.split('.');
  const last = p[p.length - 1] ?? '';
  if (p.length >= 3 && last.length === 2 && SECOND_LEVEL.has(p[p.length - 2] ?? '')) return p.slice(-3).join('.');
  return p.slice(-2).join('.');
}

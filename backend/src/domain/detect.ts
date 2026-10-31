export type IndicatorKind = 'domain' | 'ip' | 'btc' | 'eth' | 'sha256' | 'tracker' | 'email' | 'phone' | 'message' | 'unknown';
export interface Detected { kind: IndicatorKind; value: string }

export const isBtc = (a: string): boolean => /^(bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(a);
export const isEth = (a: string): boolean => /^0x[a-fA-F0-9]{40}$/.test(a);
export const isIpv4 = (a: string): boolean => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(a) && a.split('.').every((o) => Number(o) <= 255);
export const isEmail = (s: string): boolean => /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,63}$/.test(s.trim());
export const isPhone = (s: string): boolean => {
  const t = s.trim();
  if (/^[a-zA-Z]{2}-[a-zA-Z0-9]{5,8}$/.test(t)) return true; // TRAI DLT header
  const digits = t.replace(/[\s\-().]/g, '');
  return /^\+?[1-9]\d{7,14}$/.test(digits);
};
export const isMessage = (s: string): boolean => {
  const t = s.trim();
  if (t.length < 35 || !t.includes(' ')) return false;
  return /https?:\/\/|www\.|kyc|blocked|urgent|account|otp|lottery|winner|bank|electricity|pan card|apk|debit|credit|reward|police|arrest/i.test(t);
};
const DOMAIN = /^(?=.{1,253}$)([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/i;

/** Work out what kind of indicator a search string is (URLs are reduced to their host). */
export function detectIndicator(input: string): Detected {
  let v = input.trim();
  if (isMessage(v)) return { kind: 'message', value: v };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) {
    try { v = new URL(v).hostname; } catch { return { kind: 'unknown', value: v }; }
  }
  if (isEth(v)) return { kind: 'eth', value: v.toLowerCase() };
  if (/^[a-f0-9]{64}$/i.test(v)) return { kind: 'sha256', value: v.toLowerCase() };
  if (isBtc(v)) return { kind: 'btc', value: v };
  if (isIpv4(v)) return { kind: 'ip', value: v };
  if (isEmail(v)) return { kind: 'email', value: v.toLowerCase() };
  if (isPhone(v)) return { kind: 'phone', value: v };
  if (/^(UA-\d+-\d+|G-[A-Z0-9]+|GTM-[A-Z0-9]+)$/i.test(v)) return { kind: 'tracker', value: v.toUpperCase() };
  v = v.toLowerCase().replace(/\.$/, '');
  if (DOMAIN.test(v)) return { kind: 'domain', value: v };
  return { kind: 'unknown', value: v };
}

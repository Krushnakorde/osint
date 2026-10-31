import { levenshtein, secondLevelLabel, skeleton } from '../typosquat.ts';
import type { Brand } from '../types.ts';

export const FEATURE_NAMES = [
  'label_length', 'domain_length', 'digit_ratio', 'hyphen_count', 'label_count', 'entropy', 'phish_words',
  'brand_similarity', 'contains_brand', 'close_to_brand', 'cheap_tld', 'digit_in_word', 'subdomain_depth',
] as const;

const PHISH = ['login', 'signin', 'verify', 'secure', 'support', 'claim', 'bonus', 'airdrop', 'kyc', 'update', 'reward', 'wallet', 'recover', 'refund', 'helpdesk', 'cashback', 'account', 'confirm', 'unlock'];
const CHEAP_TLDS = new Set(['top', 'xyz', 'click', 'live', 'icu', 'online', 'shop', 'site', 'vip', 'club', 'work', 'buzz', 'gq', 'tk', 'ml', 'cf', 'ga', 'cfd', 'sbs', 'rest']);

function entropy(s: string): number {
  if (!s) return 0;
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) { const p = n / s.length; h -= p * Math.log2(p); }
  return h;
}

/**
 * Lexical features only: they need no network, so the classifier works on any domain the instant it is typed.
 * (Official brand domains are never scored by the model, so brand similarity cannot flag a real brand.)
 */
export function extractFeatures(domain: string, brands: Brand[]): number[] {
  const d = domain.toLowerCase();
  const parts = d.split('.');
  const sld = secondLevelLabel(d);
  const sk = skeleton(sld);
  const tld = parts[parts.length - 1] ?? '';
  let bestSim = 0; let contains = 0; let close = 0;
  for (const { name } of brands) {
    const dist = levenshtein(sk, name);
    bestSim = Math.max(bestSim, 1 - dist / Math.max(sk.length, name.length));
    if (dist <= 2 && sld !== name) close = 1;
    if (name.length >= 4 && sk.includes(name)) contains = 1;
  }
  return [
    sld.length, d.length, (sld.match(/\d/g)?.length ?? 0) / Math.max(1, sld.length), (sld.match(/-/g)?.length ?? 0),
    parts.length, entropy(sld), PHISH.filter((w) => d.includes(w)).length,
    bestSim, contains, close, CHEAP_TLDS.has(tld) ? 1 : 0, /[a-z][0-9][a-z]/.test(sld) ? 1 : 0, Math.max(0, parts.length - 2),
  ];
}

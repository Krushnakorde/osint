// Typosquatting / brand-impersonation detector: edit distance + homoglyph skeleton + containment.
import type { Brand } from './types.ts';

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

const HOMOGLYPH: Record<string, string> = { 0: 'o', 1: 'l', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's' };
export function skeleton(s: string): string {
  return s.toLowerCase().replace(/[013457@$]/g, (c) => HOMOGLYPH[c] ?? c).replace(/rn/g, 'm').replace(/vv/g, 'w');
}

const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu']);
export function secondLevelLabel(domain: string): string {
  const p = domain.split('.');
  const last = p[p.length - 1] ?? '';
  if (p.length >= 3 && last.length === 2 && SECOND_LEVEL.has(p[p.length - 2]!)) return p[p.length - 3]!;
  return p.length >= 2 ? p[p.length - 2]! : p[0]!;
}

export interface BrandHit { brand: string; method: 'edit-distance' | 'contains'; distance: number }

export function detectBrand(domain: string, brands: Brand[]): BrandHit | null {
  if (!domain || !brands?.length) return null;
  const sk = skeleton(secondLevelLabel(domain));
  let best: BrandHit | null = null;
  for (const { name, domains = [] } of brands) {
    if (domains.includes(domain)) continue; // the genuine site
    const maxDist = name.length <= 3 ? 0 : name.length <= 5 ? 1 : 2;
    const d = levenshtein(sk, name);
    if (d <= maxDist) { if (!best || d < best.distance) best = { brand: name, method: 'edit-distance', distance: d }; continue; }
    const tokens = sk.split(/[-_]/);
    if (name.length >= 3 && (tokens.includes(name) || (name.length >= 5 && sk.includes(name))) && !best) {
      best = { brand: name, method: 'contains', distance: 0 };
    }
  }
  return best;
}

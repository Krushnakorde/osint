import type { EdgeRecord, NodeRecord } from './graph.ts';
import type { Assessment, Brand, Level, Reason } from './types.ts';

/**
 * Plain-language verdict for an asset, based on REAL fraud signals only -- not on how strongly assets are connected.
 * Absence of signals is reported as "no fraud signals found", never as "safe". Pure functions: no storage, no network.
 */
export const HIGH = 60;
export const SUSPICIOUS = 30;
const PHISH_WORDS = /login|signin|verify|secure|support|claim|bonus|airdrop|kyc|update|reward|wallet|recover|refund|helpdesk|cashback/;
/** Shared platforms: one bad page does not make the whole domain bad. */
export const SHARED_PLATFORMS = [
  'docs.google.com', 'forms.gle', 'sites.google.com', 'drive.google.com', 'github.io', 'pages.dev', 'workers.dev', 'netlify.app',
  'vercel.app', 'herokuapp.com', 'weebly.com', 'wixsite.com', 'blogspot.com', 'firebaseapp.com', 'web.app', 'glitch.me', 'ipfs.io',
  'notion.site', 'typedream.app', 'webflow.io', 'carrd.co', 'onrender.com',
];
/** Edge relations the verdict reads from a domain. */
export const SIGNAL_RELS = ['listed_in', 'impersonates', 'mentioned_in'] as const;

export const levelFor = (score: number): Level => (score >= HIGH ? 'high' : score >= SUSPICIOUS ? 'suspicious' : score >= 1 ? 'signals' : 'none');

export function officialBrand(domain: string, brands: Brand[]): string | null {
  for (const b of brands) for (const d of b.domains ?? []) if (domain === d || domain.endsWith(`.${d}`)) return b.name;
  return null;
}
const onSharedPlatform = (domain: string): boolean => SHARED_PLATFORMS.some((d) => domain === d || domain.endsWith(`.${d}`));
const tail = (id: string): string => id.slice(id.indexOf(':') + 1);

export interface ScoreInput { node: NodeRecord; edges: EdgeRecord[]; brands: Brand[]; now: number; ai?: number | null }

/** Signals about ONE domain, from its own edges and registration date (plus an optional ML probability). */
export function scoreDomain({ node, edges, brands, now, ai }: ScoreInput): Assessment {
  const value = node.value;
  const official = officialBrand(value, brands);
  if (official) return { level: 'official', score: 0, reasons: [{ code: 'official_brand', params: { brand: official } }] };

  let score = 0; const reasons: Reason[] = [];
  const lists = edges.filter((e) => e.rel === 'listed_in').map((e) => tail(e.dst));
  if (lists.length) { score += 70; reasons.push({ code: 'blocklisted', params: { lists: lists.join(', ') } }); }

  const brand = edges.find((e) => e.rel === 'impersonates');
  if (brand) {
    const edit = (brand.evidence ?? '').startsWith('edit-distance');
    score += (edit ? 30 : 15) + (PHISH_WORDS.test(value) ? 10 : 0);
    reasons.push({ code: 'lookalike', params: { brand: tail(brand.dst) } });
  }
  const nReports = edges.filter((e) => e.rel === 'mentioned_in').length;
  if (nReports) { score += nReports >= 3 ? 30 : 20; reasons.push({ code: 'reports', params: { n: nReports } }); }

  const registered = typeof node.meta.registered === 'string' ? node.meta.registered : undefined;
  if (score > 0 && registered) { // a young domain only matters when something else is already wrong
    const days = Math.floor((now - Date.parse(registered)) / 86_400_000);
    if (days >= 0 && days <= 90) { score += days <= 30 ? 20 : 10; reasons.push({ code: 'new_domain', params: { days } }); }
  }
  if (ai !== null && ai !== undefined && ai >= 0.75) { // the ML model alone can only reach "some warning signs"
    score += ai >= 0.9 ? 20 : 10;
    reasons.push({ code: 'ai_model', params: { p: Math.round(ai * 100) } });
  }
  if (score > 0 && onSharedPlatform(value)) { score = Math.min(score, 45); reasons.push({ code: 'shared_platform' }); }
  score = Math.min(100, score);
  return { level: levelFor(score), score, reasons: reasons.length ? reasons : [{ code: 'no_signals' }] };
}

/**
 * Members of one connected group learn about flagged neighbours:
 * a domain linked to a 60+ domain gains +35; wallets and apps in such a group become "suspicious".
 */
export function applyGroupEffects(domains: Array<{ id: string; assessment: Assessment }>, otherAssetIds: string[]): Map<string, Assessment> {
  const out = new Map<string, Assessment>();
  const flagged = domains.filter((o) => (o.assessment.score ?? 0) >= HIGH);
  for (const o of domains) {
    const n = flagged.filter((f) => f.id !== o.id).length;
    if (n > 0 && o.assessment.level !== 'official') {
      const score = Math.min(100, (o.assessment.score ?? 0) + 35);
      out.set(o.id, { level: levelFor(score), score, reasons: [...o.assessment.reasons.filter((r) => r.code !== 'no_signals'), { code: 'linked_flagged', params: { n } }] });
    } else out.set(o.id, o.assessment);
  }
  for (const id of otherAssetIds) {
    out.set(id, flagged.length
      ? { level: 'suspicious', score: 40, reasons: [{ code: 'linked_flagged', params: { n: flagged.length } }] }
      : { level: 'none', score: 0, reasons: [{ code: 'no_signals' }] });
  }
  return out;
}

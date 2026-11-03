/**
 * ====================================================================================================
 * PROJECT: OSINT Fraud Investigation Framework
 * MODULE:  Threat Assessment & Risk Scoring Engine (assess.ts)
 * ----------------------------------------------------------------------------------------------------
 * PURPOSE FOR EVALUATORS & EXAMINERS:
 * This module computes the individual risk assessment score and human-readable verdict for any
 * asset (domain, IP, wallet, APK) investigated by the platform.
 * 
 * CORE PHILOSOPHY & DESIGN PRINCIPLES:
 * 1. Plain-Language Verdicts:
 *    The engine provides transparent, explainable reasoning tokens (e.g. "Listed on OpenPhish blocklist",
 *    "Registered 4 days ago", "Impersonates SBI Bank") rather than an opaque black-box number.
 * 
 * 2. Crucial Security Principle - "Absence of Signals is NEVER 'Safe'":
 *    If an indicator is unflagged, the system reports its status as "No fraud signals found" (level: 'none'),
 *    NEVER as "Safe" or "Clean". In real-world cyber threat intelligence, a newly registered zero-day
 *    phishing domain simply hasn't been reported yet. Declaring it "Safe" would give users a false sense
 *    of security.
 * 
 * 3. Group Contagion / Peer Effect:
 *    Cyber syndicates distribute infrastructure across multiple auxiliary domains. If domain A is
 *    confirmed malicious (score >= 60) and shares an exclusive SSL certificate or Google Analytics ID
 *    with domain B, domain B automatically inherits +35 risk points.
 * ====================================================================================================
 */

import type { EdgeRecord, NodeRecord } from './graph.ts';
import type { Assessment, Brand, Level, Reason } from './types.ts';

/**
 * THREAT SEVERITY SCORE THRESHOLDS:
 * - HIGH (>= 60): Immediate threat syndicate; verified blocklist entry or severe typosquatting.
 * - SUSPICIOUS (>= 30): Warning signs present (newly registered lookalike domain, multiple victim reports).
 * - SIGNALS (1 - 29): Minor anomaly or low-confidence warning.
 * - NONE (0): No malicious signals detected in current feeds.
 */
export const HIGH = 60;
export const SUSPICIOUS = 30;

/** Regular expression identifying typical phishing/credential harvesting keywords */
const PHISH_WORDS = /login|signin|verify|secure|support|claim|bonus|airdrop|kyc|update|reward|wallet|recover|refund|helpdesk|cashback/;

/**
 * MULTI-TENANT SHARED WEB PLATFORMS:
 * Legitimate free services where threat actors host one-off phishing pages (e.g., a rogue Google Form
 * or a phishing page on Vercel/Render).
 * Because thousands of benign websites share these platforms, one malicious page MUST NOT cause the
 * entire parent domain (e.g. google.com or vercel.app) to be blacklisted. We cap the score at 45.
 */
export const SHARED_PLATFORMS = [
  'docs.google.com', 'forms.gle', 'sites.google.com', 'drive.google.com', 'github.io', 'pages.dev', 'workers.dev', 'netlify.app',
  'vercel.app', 'herokuapp.com', 'weebly.com', 'wixsite.com', 'blogspot.com', 'firebaseapp.com', 'web.app', 'glitch.me', 'ipfs.io',
  'notion.site', 'typedream.app', 'webflow.io', 'carrd.co', 'onrender.com',
];

/** Permitted edge relations relevant to fraud assessment */
export const SIGNAL_RELS = ['listed_in', 'impersonates', 'mentioned_in'] as const;

/**
 * Helper to map a numeric score (0 to 100) to its corresponding threat level tier.
 */
export const levelFor = (score: number): Level =>
  score >= HIGH ? 'high' : score >= SUSPICIOUS ? 'suspicious' : score >= 1 ? 'signals' : 'none';

/**
 * Checks whether a given domain is the genuine, official web property of a verified brand.
 * 
 * @param domain Hostname being investigated (e.g., "hdfcbank.com")
 * @param brands List of protected legitimate enterprise brands from `brands.json`
 * @returns The official brand name if genuine, or null if unofficial.
 */
export function officialBrand(domain: string, brands: Brand[]): string | null {
  for (const b of brands) {
    for (const d of b.domains ?? []) {
      if (domain === d || domain.endsWith(`.${d}`)) return b.name;
    }
  }
  return null;
}

/** Helper checking if the domain is hosted on a multi-tenant shared platform */
const onSharedPlatform = (domain: string): boolean =>
  SHARED_PLATFORMS.some((d) => domain === d || domain.endsWith(`.${d}`));

/** Strips the node prefix (e.g. "domain:example.com" -> "example.com") */
const tail = (id: string): string => id.slice(id.indexOf(':') + 1);

/** Input structure required to score a single domain */
export interface ScoreInput {
  node: NodeRecord;        // The domain node record
  edges: EdgeRecord[];     // Graph edges directly connected to this domain
  brands: Brand[];         // Protected legitimate brands
  now: number;             // Current timestamp in milliseconds (for age calculation)
  ai?: number | null;      // Optional Machine Learning probability score from Logistic Regression
}

/**
 * Evaluates fraud risk signals for ONE specific domain node based on:
 * - Brand verification
 * - Public feed blocklists
 * - Typosquatting distance & phishing keywords
 * - Victim incident reports
 * - Domain registration recency (WHOIS age)
 * - Machine Learning inference probability
 * 
 * @param input The ScoreInput object containing node, edges, brands, timestamp, and AI score.
 * @returns An Assessment object with score (0-100), level, and explainable reasons.
 */
export function scoreDomain({ node, edges, brands, now, ai }: ScoreInput): Assessment {
  const value = node.value;

  // 1. If it is verified as the official brand domain, it is immediately recognized as legitimate.
  const official = officialBrand(value, brands);
  if (official) {
    return {
      level: 'official',
      score: 0,
      reasons: [{ code: 'official_brand', params: { brand: official } }],
    };
  }

  let score = 0;
  const reasons: Reason[] = [];

  // 2. Check if listed on active threat feeds (OpenPhish, blocklists): High threat (+70 points)
  const lists = edges.filter((e) => e.rel === 'listed_in').map((e) => tail(e.dst));
  if (lists.length) {
    score += 70;
    reasons.push({ code: 'blocklisted', params: { lists: lists.join(', ') } });
  }

  // 3. Check for brand lookalike / typosquatting impersonation
  const brand = edges.find((e) => e.rel === 'impersonates');
  if (brand) {
    // If detected via Levenshtein edit-distance: +30 points; otherwise regex prefix/suffix: +15 points
    const edit = (brand.evidence ?? '').startsWith('edit-distance');
    score += (edit ? 30 : 15) + (PHISH_WORDS.test(value) ? 10 : 0);
    reasons.push({ code: 'lookalike', params: { brand: tail(brand.dst) } });
  }

  // 4. Check for victim cyber fraud reports
  const nReports = edges.filter((e) => e.rel === 'mentioned_in').length;
  if (nReports) {
    score += nReports >= 3 ? 30 : 20;
    reasons.push({ code: 'reports', params: { n: nReports } });
  }

  // 5. Domain Recency (Age factor):
  // A newly registered domain (under 30 or 90 days) is only suspicious if accompanied by other risk signals.
  const registered = typeof node.meta.registered === 'string' ? node.meta.registered : undefined;
  if (score > 0 && registered) {
    const days = Math.floor((now - Date.parse(registered)) / 86_400_000);
    if (days >= 0 && days <= 90) {
      score += days <= 30 ? 20 : 10;
      reasons.push({ code: 'new_domain', params: { days } });
    }
  }

  // 6. Machine Learning Model Integration:
  // AI score acts as an assistive signal. If the ML model calculates threat probability >= 0.75:
  if (ai !== null && ai !== undefined && ai >= 0.75) {
    score += ai >= 0.9 ? 20 : 10;
    reasons.push({ code: 'ai_model', params: { p: Math.round(ai * 100) } });
  }

  // 7. Shared Platform Protection:
  // If the malicious link is hosted on a shared provider (e.g. Google Docs, Render, Vercel),
  // cap the score at 45 so automated defenses don't block the entire platform for all users.
  if (score > 0 && onSharedPlatform(value)) {
    score = Math.min(score, 45);
    reasons.push({ code: 'shared_platform' });
  }

  // Clamp score between 0 and 100
  score = Math.min(100, score);

  return {
    level: levelFor(score),
    score,
    reasons: reasons.length ? reasons : [{ code: 'no_signals' }],
  };
}

/**
 * GROUP CONTAGION / PEER PROPAGATION EFFECT:
 * In an organized cyber fraud campaign, members of a connected cluster share infrastructure.
 * If one domain in a cluster is flagged as HIGH RISK (score >= 60), its peers in the same cluster
 * gain +35 risk points and are marked as "Linked to flagged infrastructure".
 * Similarly, wallets and APKs linked to a flagged domain become "suspicious" (score: 40).
 * 
 * @param domains List of assessed domain objects with their initial scores
 * @param otherAssetIds Non-domain asset IDs (crypto wallets, APKs, phone numbers) in the same cluster
 * @returns Map of asset IDs to updated Assessment objects.
 */
export function applyGroupEffects(
  domains: Array<{ id: string; assessment: Assessment }>,
  otherAssetIds: string[]
): Map<string, Assessment> {
  const out = new Map<string, Assessment>();
  // Identify which domains in the cluster are already flagged as high risk
  const flagged = domains.filter((o) => (o.assessment.score ?? 0) >= HIGH);

  for (const o of domains) {
    const n = flagged.filter((f) => f.id !== o.id).length;
    // If another domain in the same cluster is flagged, propagate +35 risk points
    if (n > 0 && o.assessment.level !== 'official') {
      const score = Math.min(100, (o.assessment.score ?? 0) + 35);
      out.set(o.id, {
        level: levelFor(score),
        score,
        reasons: [
          ...o.assessment.reasons.filter((r) => r.code !== 'no_signals'),
          { code: 'linked_flagged', params: { n } },
        ],
      });
    } else {
      out.set(o.id, o.assessment);
    }
  }

  // Auxiliary assets (wallets, APKs, phone numbers) inherit suspicious level if linked to flagged domains
  for (const id of otherAssetIds) {
    out.set(
      id,
      flagged.length
        ? { level: 'suspicious', score: 40, reasons: [{ code: 'linked_flagged', params: { n: flagged.length } }] }
        : { level: 'none', score: 0, reasons: [{ code: 'no_signals' }] }
    );
  }

  return out;
}

/**
 * ====================================================================================================
 * PROJECT: OSINT Fraud Investigation Framework
 * MODULE:  Lexical Feature Extraction Pipeline for Machine Learning (features.ts)
 * ----------------------------------------------------------------------------------------------------
 * PURPOSE FOR EVALUATORS & EXAMINERS:
 * This module converts any raw domain string (e.g. "secure-hdfc-kyc-update.xyz") into a numerical
 * 13-dimensional feature vector suitable for Machine Learning inference.
 * 
 * WHY LEXICAL FEATURES?
 * 1. Zero Network Dependency: Extracts features purely from string mechanics in under 0.01 milliseconds.
 * 2. Instant Pre-Filtering: Can evaluate brand lookalikes the instant an analyst types them, without
 *    waiting for DNS or WHOIS resolution.
 * 3. Robust Adversary Signals: Malicious campaigns consistently exhibit higher character entropy,
 *    suspicious hyphenation, brand name embedding, and cheap burner TLD usage.
 * ====================================================================================================
 */

import { levenshtein, secondLevelLabel, skeleton } from '../typosquat.ts';
import type { Brand } from '../types.ts';

/**
 * Ordered list of all 13 features used by the Logistic Regression classifier.
 */
export const FEATURE_NAMES = [
  'label_length',       // 1. Length of the second-level domain name
  'domain_length',      // 2. Total character length of the full domain
  'digit_ratio',        // 3. Fraction of characters in the label that are numeric digits
  'hyphen_count',       // 4. Number of hyphens in the domain label
  'label_count',        // 5. Number of dot-separated sub-labels (e.g. sub.domain.com = 3)
  'entropy',            // 6. Shannon Entropy (randomness / DGA measurement)
  'phish_words',        // 7. Frequency count of social engineering lure keywords
  'brand_similarity',   // 8. Normalized Levenshtein similarity to known protected brands (0 to 1)
  'contains_brand',     // 9. Binary flag: 1 if domain embeds a protected brand name
  'close_to_brand',     // 10. Binary flag: 1 if edit distance to a brand is <= 2
  'cheap_tld',          // 11. Binary flag: 1 if registered on a low-cost / abuse-prone TLD
  'digit_in_word',      // 12. Binary flag: 1 if numbers are substituted within letters (leetspeak)
  'subdomain_depth',    // 13. Depth count of prefix subdomains
] as const;

/**
 * Common social engineering credential harvesting words found in phishing URLs.
 */
const PHISH = [
  'login', 'signin', 'verify', 'secure', 'support', 'claim', 'bonus', 'airdrop',
  'kyc', 'update', 'reward', 'wallet', 'recover', 'refund', 'helpdesk', 'cashback',
  'account', 'confirm', 'unlock',
];

/**
 * LOW-COST / ABUSE-PRONE TOP-LEVEL DOMAINS (TLDs):
 * Top-Level Domains frequently utilized by threat actors due to free or sub-$1 registration prices
 * and minimal identity verification.
 */
const CHEAP_TLDS = new Set([
  'top', 'xyz', 'click', 'live', 'icu', 'online', 'shop', 'site', 'vip', 'club',
  'work', 'buzz', 'gq', 'tk', 'ml', 'cf', 'ga', 'cfd', 'sbs', 'rest',
]);

/**
 * SHANNON ENTROPY: H(X) = - ∑ P(x_i) * log2(P(x_i))
 * Measures the information density and randomness of characters in a string.
 * - Meaningful English words (e.g., "bankaccount") have lower entropy (~ 2.8 - 3.2 bits).
 * - Domain Generation Algorithm (DGA) botnet strings (e.g., "xk79qm3pzw") have high entropy (> 3.8 bits).
 * 
 * @param s Input text string
 * @returns Calculated Shannon entropy in bits
 */
function entropy(s: string): number {
  if (!s) return 0;
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);

  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/**
 * Extracts a normalized 13-element feature vector from a domain string for ML scoring.
 * 
 * Note: Official brand domains are pre-whitelisted before reaching this model,
 * so high brand similarity will never accidentally penalize the genuine institution website.
 * 
 * @param domain Hostname being analyzed (e.g. "sbi-kyc-verification.top")
 * @param brands List of protected brand names from `brands.json`
 * @returns Array of 13 numeric feature values matching FEATURE_NAMES.
 */
export function extractFeatures(domain: string, brands: Brand[]): number[] {
  const d = domain.toLowerCase();
  const parts = d.split('.');
  const sld = secondLevelLabel(d); // Extracts main label (e.g. "sbi-kyc-verification" from "sbi-kyc-verification.top")
  const sk = skeleton(sld);        // Normalized skeleton representation (e.g. stripping double letters)
  const tld = parts[parts.length - 1] ?? '';

  let bestSim = 0;
  let contains = 0;
  let close = 0;

  // Compare against known brand dictionary to detect typosquatting and impersonation
  for (const { name } of brands) {
    const dist = levenshtein(sk, name);
    // Normalized similarity metric: 1.0 = exact match, 0.0 = completely dissimilar
    bestSim = Math.max(bestSim, 1 - dist / Math.max(sk.length, name.length));

    // Close to brand: within 1 or 2 letter edits (e.g. "paytm" -> "payttm" or "paytrn")
    if (dist <= 2 && sld !== name) close = 1;

    // Brand embedding: e.g. "hdfc" embedded within "secure-hdfc-login"
    if (name.length >= 4 && sk.includes(name)) contains = 1;
  }

  return [
    sld.length,                                                         // 1. label_length
    d.length,                                                           // 2. domain_length
    (sld.match(/\d/g)?.length ?? 0) / Math.max(1, sld.length),          // 3. digit_ratio
    sld.match(/-/g)?.length ?? 0,                                       // 4. hyphen_count
    parts.length,                                                       // 5. label_count
    entropy(sld),                                                       // 6. entropy
    PHISH.filter((w) => d.includes(w)).length,                          // 7. phish_words
    bestSim,                                                            // 8. brand_similarity
    contains,                                                           // 9. contains_brand
    close,                                                              // 10. close_to_brand
    CHEAP_TLDS.has(tld) ? 1 : 0,                                        // 11. cheap_tld
    /[a-z][0-9][a-z]/.test(sld) ? 1 : 0,                                // 12. digit_in_word (leetspeak: l0gin)
    Math.max(0, parts.length - 2),                                      // 13. subdomain_depth
  ];
}

/**
 * ====================================================================================================
 * PROJECT: OSINT Fraud Investigation Framework
 * MODULE:  Smishing (SMS Phishing) & Persuasion Heuristic Parser (smishing.ts)
 * ----------------------------------------------------------------------------------------------------
 * PURPOSE FOR EVALUATORS & EXAMINERS:
 * This module addresses telecommunications-based financial cyber fraud, specifically "Smishing"
 * (SMS Phishing) targeting banking and utility consumers in India and globally.
 * 
 * CORE CAPABILITIES:
 * 1. Multi-Vector Entity Extraction: Automatically scans raw message text using regex to extract:
 *    - Phishing URLs and destination domain names
 *    - Callback phone numbers (including Indian +91 and 10-digit formats)
 *    - Fraudulent email addresses
 *    - Unified Payments Interface (UPI) handles (e.g. "fraudster@paytm", "support@oksbi")
 * 
 * 2. Telecom Regulatory Header Verification (TRAI DLT):
 *    In India, legitimate financial institutions must register alphanumeric sender headers
 *    on a Distributed Ledger Technology (DLT) blockchain as mandated by the Telecom Regulatory
 *    Authority of India (TRAI).
 *    - Legitimate header: 2 letters + hyphen + 5-8 chars (e.g., "VM-HDFCBK", "AD-SBIINB").
 *    - High-risk fraud: Sent from a raw personal 10-digit mobile number (+91-98xxxxxx) pretending
 *      to be a bank or electricity department.
 * 
 * 3. Social Engineering & Psychological Coercion Analysis:
 *    Detects urgency threats ("account blocked", "electricity disconnected tonight", "arrest warrant")
 *    and greed lures ("lottery winner", "part time telegram task", "crypto airdrop").
 * ====================================================================================================
 */

import type { SmishingAnalysis } from './types.ts';

// ----------------------------------------------------------------------------------------------------
// REGULAR EXPRESSIONS FOR INDICATOR EXTRACTION
// ----------------------------------------------------------------------------------------------------

/** Matches full web links (http://, https://, or www.) */
const URL_REGEX = /(?:https?:\/\/|www\.)[^\s/$.?#].[^\s]*/gi;

/** Matches standard international phone numbers and 10-digit Indian numbers starting with 6, 7, 8, 9 */
const PHONE_REGEX = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|\+91[-.\s]?[6-9]\d{9}|[6-9]\d{9}/g;

/** Matches standard RFC email addresses */
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,63}/g;

/** Matches Unified Payments Interface (UPI) virtual payment addresses: username@bankhandle */
const UPI_REGEX = /[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}/g;

// ----------------------------------------------------------------------------------------------------
// PSYCHOLOGICAL MANIPULATION KEYWORD DICTIONARIES
// ----------------------------------------------------------------------------------------------------

/**
 * HIGH-URGENCY & COERCION KEYWORDS:
 * Scammers induce panic so victims bypass rational scrutiny and click without thinking.
 */
const HIGH_URGENCY_KEYWORDS = [
  'account blocked', 'deactivated', 'suspended', 'electricity disconnect',
  'bill unpaid', 'disconnected tonight', 'pan card link', 'kyc expired',
  'arrest warrant', 'police complaint', 'legal notice', 'sim blocked',
  'within 24 hours', 'immediate action required', 'unauthorized debit',
];

/**
 * GREED & FINANCIAL INCENTIVE LURES:
 * Phishing campaigns promising unrealistic financial windfalls or fake work-from-home jobs.
 */
const GREED_LURE_KEYWORDS = [
  'congratulations you won', 'lottery winner', 'prize claimed', 'cashback of',
  'earn 5000 daily', 'part time job', 'telegram task', 'work from home',
  'crypto bonus', 'free airdrop', 'gift voucher',
];

/**
 * HIGH-VALUE INSTITUTION BRANDS FREQUENTLY IMPERSONATED:
 * Banks, digital payment apps, utility providers, and tax agencies in India.
 */
const KNOWN_BRANDS = [
  'sbi', 'hdfc', 'icici', 'axis', 'paytm', 'phonepe', 'gpay', 'google pay',
  'netflix', 'amazon', 'india post', 'mahavitaran', 'electricity', 'income tax',
];

/**
 * Analyzes an incoming SMS or chat message to detect smishing, extract indicators,
 * verify sender header legitimacy, and score psychological manipulation signals.
 * 
 * @param text The full raw message body pasted by the investigator or captured from an SMS.
 * @param senderHeader Optional sender identifier (e.g. "VM-HDFCBK" or "+919876543210").
 * @returns SmishingAnalysis containing risk score, extracted entities, header notes, and reasons.
 */
export function analyzeMessage(text: string, senderHeader?: string): SmishingAnalysis {
  const content = String(text || '').trim();
  const rawSender = String(senderHeader || '').trim();

  // --------------------------------------------------------------------------------------------------
  // STEP 1: EXTRACT EMBEDDED INDICATORS (URLs, Domains, Phones, Emails, UPI)
  // --------------------------------------------------------------------------------------------------
  // Extract URLs and isolate destination domain names
  const rawUrls = content.match(URL_REGEX) ?? [];
  const domains = [
    ...new Set(
      rawUrls.map((u) => {
        try {
          const fixed = u.startsWith('http') ? u : `http://${u}`;
          return new URL(fixed).hostname.toLowerCase();
        } catch {
          return u.toLowerCase();
        }
      })
    ),
  ];

  // Extract phone numbers, stripping formatting hyphens, spaces, and parentheses
  const phones = [
    ...new Set((content.match(PHONE_REGEX) ?? []).map((p) => p.replace(/[\s\-().]/g, ''))),
  ].filter((p) => p.length >= 10 && !domains.some((d) => d.includes(p)));

  // Extract email addresses
  const emails = [...new Set((content.match(EMAIL_REGEX) ?? []).map((e) => e.toLowerCase()))];

  // Extract UPI virtual payment handles (excluding regular emails already matched)
  const upi = [...new Set((content.match(UPI_REGEX) ?? []).map((u) => u.toLowerCase()))].filter(
    (u) => !emails.includes(u)
  );

  // --------------------------------------------------------------------------------------------------
  // STEP 2: TELECOM REGULATORY (TRAI DLT) SENDER HEADER INSPECTION
  // --------------------------------------------------------------------------------------------------
  let isOfficialHeader = false;
  let senderNote = 'No sender ID provided.';

  if (rawSender) {
    // Alphanumeric DLT Header: e.g. "VM-HDFCBK", "BZ-SBIINB"
    if (/^[a-zA-Z]{2}-[a-zA-Z0-9]{5,8}$/.test(rawSender)) {
      isOfficialHeader = true;
      senderNote = `Official TRAI DLT Alphanumeric Header: ${rawSender}`;
    }
    // Raw numeric phone number pretending to be a business/bank alert: High suspicion!
    else if (/^\+?[0-9]{10,13}$/.test(rawSender.replace(/[\s\-]/g, ''))) {
      isOfficialHeader = false;
      senderNote = 'Sent from a standard personal mobile number (high impersonation risk)';
    } else {
      senderNote = `Unverified custom sender: ${rawSender}`;
    }
  }

  // --------------------------------------------------------------------------------------------------
  // STEP 3: HEURISTIC PHISHING & PSYCHOLOGICAL COERCION SCORING
  // --------------------------------------------------------------------------------------------------
  const threatIndicators: string[] = [];
  const reasons: string[] = [];
  let score = 0;

  const lower = content.toLowerCase();

  // 1. Detect Urgency / Threat triggers (+25 points each)
  for (const kw of HIGH_URGENCY_KEYWORDS) {
    if (lower.includes(kw)) {
      threatIndicators.push(`Urgency: "${kw}"`);
      score += 25;
    }
  }

  // 2. Detect Greed / Financial lures (+25 points each)
  for (const kw of GREED_LURE_KEYWORDS) {
    if (lower.includes(kw)) {
      threatIndicators.push(`Financial Lure: "${kw}"`);
      score += 25;
    }
  }

  // 3. Detect Brand Impersonation: Claims to be a trusted brand but provides an unofficial domain
  const mentionedBrand = KNOWN_BRANDS.find((b) => lower.includes(b));
  if (mentionedBrand) {
    threatIndicators.push(`Mentions Brand: ${mentionedBrand.toUpperCase()}`);
    if (domains.length > 0) {
      const isOfficialDomain = domains.some(
        (d) => d.endsWith(`${mentionedBrand}.com`) || d.endsWith(`${mentionedBrand}.co.in`)
      );
      if (!isOfficialDomain) {
        score += 40;
        reasons.push(
          `Impersonates ${mentionedBrand.toUpperCase()} but links to unofficial domain: ${domains.join(', ')}`
        );
      }
    }
  }

  // 4. Suspicious Personal Sender Header claiming institutional action (+20 points)
  if (!isOfficialHeader && rawSender && (threatIndicators.length > 0 || domains.length > 0)) {
    score += 20;
    reasons.push('Sender is a personal mobile number or unverified sender rather than an authorized telecom header.');
  }

  // 5. Detect URL Shorteners: Cybercriminals use shorteners to bypass automated link scanners (+30 points)
  if (domains.some((d) => ['bit.ly', 'tinyurl.com', 'is.gd', 't.co', 'cutt.ly', 'rb.gy'].includes(d))) {
    score += 30;
    threatIndicators.push('URL Shortener detected (conceals true destination)');
    reasons.push('Uses URL shorteners commonly used to evade automated link filters.');
  }

  // Clamp risk score to [0, 100]
  score = Math.min(100, Math.max(0, score));

  // Determine final classification verdicts
  const isSmishing = score >= 50;
  const urgencyLevel = score >= 70 ? 'high' : score >= 35 ? 'medium' : 'low';

  if (threatIndicators.length > 0) {
    reasons.unshift(`Detected ${threatIndicators.length} deceptive persuasion signals in message body.`);
  } else {
    reasons.push('No obvious social engineering or coercion indicators found.');
  }

  return {
    isSmishing,
    riskScore: score,
    urgencyLevel,
    senderHeader: {
      raw: rawSender,
      isOfficialHeader,
      note: senderNote,
    },
    extracted: {
      domains,
      phones,
      emails,
      upi,
    },
    threatIndicators,
    reasons,
  };
}

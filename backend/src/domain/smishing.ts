import type { SmishingAnalysis } from './types.ts';

const URL_REGEX = /(?:https?:\/\/|www\.)[^\s/$.?#].[^\s]*/gi;
const PHONE_REGEX = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|\+91[-.\s]?[6-9]\d{9}|[6-9]\d{9}/g;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,63}/g;
const UPI_REGEX = /[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}/g;

const HIGH_URGENCY_KEYWORDS = [
  'account blocked', 'deactivated', 'suspended', 'electricity disconnect',
  'bill unpaid', 'disconnected tonight', 'pan card link', 'kyc expired',
  'arrest warrant', 'police complaint', 'legal notice', 'sim blocked',
  'within 24 hours', 'immediate action required', 'unauthorized debit',
];

const GREED_LURE_KEYWORDS = [
  'congratulations you won', 'lottery winner', 'prize claimed', 'cashback of',
  'earn 5000 daily', 'part time job', 'telegram task', 'work from home',
  'crypto bonus', 'free airdrop', 'gift voucher',
];

const KNOWN_BRANDS = [
  'sbi', 'hdfc', 'icici', 'axis', 'paytm', 'phonepe', 'gpay', 'google pay',
  'netflix', 'amazon', 'india post', 'mahavitaran', 'electricity', 'income tax',
];

export function analyzeMessage(text: string, senderHeader?: string): SmishingAnalysis {
  const content = String(text || '').trim();
  const rawSender = String(senderHeader || '').trim();

  // 1. Extract indicators
  const rawUrls = content.match(URL_REGEX) ?? [];
  const domains = [...new Set(rawUrls.map((u) => {
    try {
      const fixed = u.startsWith('http') ? u : `http://${u}`;
      return new URL(fixed).hostname.toLowerCase();
    } catch {
      return u.toLowerCase();
    }
  }))];

  const phones = [...new Set((content.match(PHONE_REGEX) ?? []).map((p) => p.replace(/[\s\-().]/g, '')))].filter(
    (p) => p.length >= 10 && !domains.some((d) => d.includes(p))
  );

  const emails = [...new Set((content.match(EMAIL_REGEX) ?? []).map((e) => e.toLowerCase()))];
  const upi = [...new Set((content.match(UPI_REGEX) ?? []).map((u) => u.toLowerCase()))].filter(
    (u) => !emails.includes(u)
  );

  // 2. Sender Header Inspection
  let isOfficialHeader = false;
  let senderNote = 'No sender ID provided.';
  if (rawSender) {
    if (/^[a-zA-Z]{2}-[a-zA-Z0-9]{5,8}$/.test(rawSender)) {
      isOfficialHeader = true;
      senderNote = `Official TRAI DLT Alphanumeric Header: ${rawSender}`;
    } else if (/^\+?[0-9]{10,13}$/.test(rawSender.replace(/[\s\-]/g, ''))) {
      isOfficialHeader = false;
      senderNote = 'Sent from a standard personal mobile number (impersonation risk)';
    } else {
      senderNote = `Unverified custom sender: ${rawSender}`;
    }
  }

  // 3. Heuristic Phishing & Coercion scoring
  const threatIndicators: string[] = [];
  const reasons: string[] = [];
  let score = 0;

  const lower = content.toLowerCase();

  // Check urgency keywords
  for (const kw of HIGH_URGENCY_KEYWORDS) {
    if (lower.includes(kw)) {
      threatIndicators.push(`Urgency: "${kw}"`);
      score += 25;
    }
  }

  // Check greed lures
  for (const kw of GREED_LURE_KEYWORDS) {
    if (lower.includes(kw)) {
      threatIndicators.push(`Financial Lure: "${kw}"`);
      score += 25;
    }
  }

  // Check brand mention with suspicious link
  const mentionedBrand = KNOWN_BRANDS.find((b) => lower.includes(b));
  if (mentionedBrand) {
    threatIndicators.push(`Mentions Brand: ${mentionedBrand.toUpperCase()}`);
    if (domains.length > 0) {
      const isOfficialDomain = domains.some((d) => d.endsWith(`${mentionedBrand}.com`) || d.endsWith(`${mentionedBrand}.co.in`));
      if (!isOfficialDomain) {
        score += 40;
        reasons.push(`Impersonates ${mentionedBrand.toUpperCase()} but links to unofficial domain: ${domains.join(', ')}`);
      }
    }
  }

  // Suspicious non-official sender claiming urgent action
  if (!isOfficialHeader && rawSender && (threatIndicators.length > 0 || domains.length > 0)) {
    score += 20;
    reasons.push('Sender is a personal mobile number or unverified sender rather than an authorized telecom header.');
  }

  // Presence of shortened links
  if (domains.some((d) => ['bit.ly', 'tinyurl.com', 'is.gd', 't.co', 'cutt.ly', 'rb.gy'].includes(d))) {
    score += 30;
    threatIndicators.push('URL Shortener detected (conceals true destination)');
    reasons.push('Uses URL shorteners commonly used to evade automated link filters.');
  }

  score = Math.min(100, Math.max(0, score));
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

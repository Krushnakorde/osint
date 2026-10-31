import { officialBrand } from './assess.ts';
import { detectBrand } from './typosquat.ts';
import type { Assessment, Brand, EmailFacts, Reason } from './types.ts';

const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'tempmail.com', '10minutemail.com', 'guerrillamail.com', 'throwawaymail.com',
  'sharklasers.com', 'yopmail.com', 'dispostable.com', 'trashmail.com', 'fakeinbox.com',
  'getairmail.com', 'mohmal.com', 'temp-mail.org', 'crazymailing.com', 'nada.ltd',
  'mytemp.email', 'dropmail.me', 'inboxkitten.com', 'burnermail.io', 'generator.email',
]);

const FREE_WEBMAIL = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'protonmail.com',
  'proton.me', 'aol.com', 'zoho.com', 'gmx.com', 'mail.com', 'yandex.com',
]);

export function verifyEmail(email: string, brands: Brand[] = []): { facts: EmailFacts; assessment: Assessment } {
  const clean = String(email).trim().toLowerCase();
  const parts = clean.split('@');
  const user = parts[0] ?? '';
  const domain = parts[1] ?? '';

  const isDisposable = DISPOSABLE_DOMAINS.has(domain);
  const isFreeWebmail = FREE_WEBMAIL.has(domain);
  const brandHit = detectBrand(domain, brands);
  const official = officialBrand(domain, brands);

  const facts: EmailFacts = {
    email: clean,
    domain,
    isDisposable,
    isFreeWebmail,
    impersonatesBrand: brandHit?.brand,
  };

  const reasons: Reason[] = [];
  let score = 0;

  if (official) {
    return {
      facts,
      assessment: {
        level: 'official',
        score: 0,
        reasons: [{ code: 'official_brand', params: { brand: official } }],
      },
    };
  }

  if (isDisposable) {
    score += 75;
    reasons.push({ code: 'blocklisted', params: { lists: 'Disposable/Burner Email Provider' } });
  }

  if (brandHit) {
    score += 45;
    reasons.push({ code: 'lookalike', params: { brand: brandHit.brand } });
  }

  // Look for suspicious keywords in user part (e.g. security-team, support, kyc-verification)
  if (/security|support|verify|kyc|helpdesk|admin|banking|fraud|otp/i.test(user)) {
    if (isFreeWebmail) {
      score += 35; // e.g. "sbi-support-team@gmail.com"
      reasons.push({ code: 'lookalike', params: { brand: 'Official Support via Free Webmail' } });
    }
  }

  score = Math.min(100, score);
  const level = score >= 60 ? 'high' : score >= 30 ? 'suspicious' : score > 0 ? 'signals' : 'none';
  if (!reasons.length) reasons.push({ code: 'no_signals' });

  return {
    facts,
    assessment: { level, score, reasons },
  };
}

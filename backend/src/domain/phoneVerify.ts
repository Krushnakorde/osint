import type { Assessment, PhoneFacts, Reason } from './types.ts';

interface CountryInfo { name: string; minLen: number; maxLen: number }

const COUNTRY_PREFIXES: Record<string, CountryInfo> = {
  '91': { name: 'India', minLen: 10, maxLen: 10 },
  '1':  { name: 'United States / Canada', minLen: 10, maxLen: 10 },
  '44': { name: 'United Kingdom', minLen: 10, maxLen: 10 },
  '84': { name: 'Vietnam', minLen: 9, maxLen: 10 },
  '234': { name: 'Nigeria', minLen: 10, maxLen: 11 },
  '7':  { name: 'Russia / Kazakhstan', minLen: 10, maxLen: 10 },
  '62': { name: 'Indonesia', minLen: 9, maxLen: 12 },
  '86': { name: 'China', minLen: 11, maxLen: 11 },
  '971': { name: 'United Arab Emirates', minLen: 9, maxLen: 9 },
};

// Known high-risk VoIP area codes in North America often used in robocall / fraud scams
const VOIP_US_PREFIXES = new Set(['202', '312', '415', '650', '800', '888', '877', '866', '855']);

export function verifyPhone(phoneInput: string): { facts: PhoneFacts; assessment: Assessment } {
  const raw = String(phoneInput).trim();
  const isHeader = /^[a-zA-Z]{2}-[a-zA-Z0-9]{5,8}$/.test(raw);

  if (isHeader) {
    const parts = raw.split('-');
    const sender = parts[1]?.toUpperCase() ?? '';
    const facts: PhoneFacts = {
      phone: raw.toUpperCase(),
      isOfficialHeader: true,
      headerSender: sender,
    };
    return {
      facts,
      assessment: {
        level: 'official',
        score: 0,
        reasons: [{ code: 'official_brand', params: { brand: `Registered TRAI Header (${sender})` } }],
      },
    };
  }

  const digits = raw.replace(/\D/g, '');
  let cc: string | undefined;
  let country: CountryInfo | undefined;

  for (const prefix of ['971', '234', '91', '44', '84', '62', '86', '1', '7']) {
    if (digits.startsWith(prefix)) {
      cc = prefix;
      country = COUNTRY_PREFIXES[prefix];
      break;
    }
  }

  // If no prefix matched and exactly 10 digits, default to India (+91)
  if (!cc && digits.length === 10) {
    cc = '91';
    country = COUNTRY_PREFIXES['91'];
  }

  const isVoip = cc === '1' && VOIP_US_PREFIXES.has(digits.slice(1, 4));
  const facts: PhoneFacts = {
    phone: `+${digits}`,
    countryCode: cc ? `+${cc}` : undefined,
    countryName: country?.name,
    isVoip,
    isOfficialHeader: false,
  };

  const reasons: Reason[] = [];
  let score = 0;

  if (isVoip) {
    score += 35;
    reasons.push({ code: 'shared_platform', params: {} });
  }

  // Suspicious foreign numbers frequently seen in WhatsApp impersonation scams (+234, +84)
  if (cc === '234' || cc === '84') {
    score += 25;
  }

  const level = score >= 60 ? 'high' : score >= 30 ? 'suspicious' : score > 0 ? 'signals' : 'none';
  if (!reasons.length) reasons.push({ code: 'no_signals' });

  return {
    facts,
    assessment: { level, score, reasons },
  };
}

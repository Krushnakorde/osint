import { verifyEmail } from '../../domain/emailVerify.ts';
import { verifyPhone } from '../../domain/phoneVerify.ts';
import type { Collector } from './types.ts';

export const emailCollector: Collector = {
  name: 'email-verify',
  kinds: ['email'],
  async run({ value, brands }) {
    const { facts } = verifyEmail(value, brands);
    return {
      obs: {
        emails: [value],
        domain: facts.domain,
      },
      exists: true,
      note: facts.isDisposable
        ? 'Disposable / burner email domain detected'
        : facts.impersonatesBrand
        ? `Lookalike domain imitating ${facts.impersonatesBrand}`
        : facts.isFreeWebmail
        ? 'Free public webmail provider'
        : 'Domain verified',
    };
  },
};

export const phoneCollector: Collector = {
  name: 'phone-verify',
  kinds: ['phone'],
  async run({ value }) {
    const { facts } = verifyPhone(value);
    return {
      obs: {
        phones: [value],
      },
      exists: true,
      note: facts.isOfficialHeader
        ? `Official TRAI telecom header: ${facts.headerSender}`
        : facts.countryName
        ? `Country: ${facts.countryName}${facts.isVoip ? ' (VoIP/Virtual number range)' : ''}`
        : 'Valid phone number',
    };
  },
};

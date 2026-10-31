import { getJson } from '../net-guard.ts';
import { registrableDomain } from '../../domain/normalize.ts';
import type { Collector } from './types.ts';

interface RdapEntity { roles?: string[]; vcardArray?: [string, Array<[string, unknown, string, unknown]>] }
export interface Rdap {
  entities?: RdapEntity[]; nameservers?: Array<{ ldhName?: string }>; events?: Array<{ eventAction?: string; eventDate?: string }>;
}

export function parseRdap(j: Rdap): { registrar?: string; nameservers: string[]; registered?: string } {
  const reg = (j.entities ?? []).find((e) => e.roles?.includes('registrar'));
  const fn = reg?.vcardArray?.[1]?.find((x) => x[0] === 'fn')?.[3];
  return {
    registrar: typeof fn === 'string' ? fn : undefined,
    nameservers: (j.nameservers ?? []).map((n) => (n.ldhName ?? '').toLowerCase()).filter(Boolean),
    registered: j.events?.find((e) => e.eventAction === 'registration')?.eventDate,
  };
}

/** Registration data from the public RDAP system (registry servers, never the target). */
export const rdap: Collector = {
  name: 'rdap', kinds: ['domain'],
  async run({ value }) {
    const j = await getJson<Rdap>(`https://rdap.org/domain/${encodeURIComponent(registrableDomain(value))}`);
    const r = parseRdap(j);
    return { obs: { domain: value, registrar: r.registrar, nameservers: r.nameservers, registered: r.registered }, exists: !!(r.registrar || r.registered) };
  },
};

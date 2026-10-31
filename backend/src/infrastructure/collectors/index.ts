import type { Collector } from '../../application/collectors.ts';
import { btc, eth } from './blockchain.ts';
import { emailCollector, phoneCollector } from './contacts.ts';
import { ctDomain, ctFingerprint } from './ct.ts';
import { asnIp, dohDomain } from './doh.ts';
import { blocklists } from './lists.ts';
import { otxDomain, otxIp } from './otx.ts';
import { rdap } from './rdap.ts';
import { urlscanDomain, urlscanIp } from './urlscan.ts';
import { vtDomain, vtFile } from './vt.ts';

/** The registry of live sources. Add a source here (one object) and the lookup service uses it: no other code changes. */
export const DEFAULT_COLLECTORS: Collector[] = [
  dohDomain, rdap, ctDomain, urlscanDomain, otxDomain, blocklists, vtDomain, // domain
  asnIp, urlscanIp, otxIp,                                                   // ip
  btc, eth,                                                                  // wallets
  ctFingerprint, vtFile,                                                     // 64-hex hash
  emailCollector, phoneCollector,                                            // email & phone
];

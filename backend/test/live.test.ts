import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_COLLECTORS } from '../src/infrastructure/collectors/index.ts';
import { parseAnswers, parseCymruOrigin } from '../src/infrastructure/collectors/doh.ts';
import { parseRdap } from '../src/infrastructure/collectors/rdap.ts';
import { setListForTests } from '../src/infrastructure/collectors/lists.ts';
import { matchCertUpdate } from '../src/infrastructure/background/certstream.ts';
import { isAllowedUrl, safeFetch } from '../src/infrastructure/net-guard.ts';
import { brands, world } from './helpers.ts';

const live = { mode: 'live' as const };
const json = (x: unknown): Response => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });

/** A fake public internet. Anything not routed here fails the test by throwing. */
function mockInternet(routes: Array<[RegExp, () => Response]>): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    for (const [re, make] of routes) if (re.test(url)) return make();
    throw new Error(`unexpected request to ${url}`);
  }) as typeof fetch;
  return () => { globalThis.fetch = real; };
}

const GOOD: Array<[RegExp, () => Response]> = [
  [/dns\.google\/resolve\?name=evil-paypa1\.top&type=A/, () => json({ Status: 0, Answer: [{ name: 'evil-paypa1.top.', type: 1, data: '203.0.113.7' }] })],
  [/dns\.google\/resolve\?name=evil-paypa1\.top&type=NS/, () => json({ Status: 0, Answer: [{ name: 'evil-paypa1.top.', type: 2, data: 'NS1.Badhost.Example.' }] })],
  [/dns\.google\/resolve\?name=7\.113\.0\.203\.origin\.asn\.cymru\.com&type=TXT/, () => json({ Status: 0, Answer: [{ name: 'x.', type: 16, data: '"64500 | 203.0.113.0/24 | US | arin | 2020-01-01"' }] })],
  [/rdap\.org\/domain\/evil-paypa1\.top/, () => json({ entities: [{ roles: ['registrar'], vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', 'Shady Registrar LLC']]] }], nameservers: [{ ldhName: 'NS1.BADHOST.EXAMPLE' }], events: [{ eventAction: 'registration', eventDate: '2026-10-01T00:00:00Z' }] })],
  [/crt\.sh\/\?q=evil-paypa1\.top/, () => json([{ issuer_ca_id: 183267, serial_number: 'ABC123', name_value: 'evil-paypa1.top\nwww.evil-paypa1.top' }])],
  [/urlscan\.io\/api\/v1\/search\/\?q=domain%3Aevil-paypa1\.top/, () => json({ results: [{ page: { ip: '203.0.113.7', asn: 'AS64500', domain: 'evil-paypa1.top' } }] })],
  [/urlscan\.io\/api\/v1\/search\/\?q=page\.ip%3A%22203\.0\.113\.7%22/, () => json({ total: 3, results: [{ page: { domain: 'evil-paypa1.top', ip: '203.0.113.7' } }, { page: { domain: 'sibling-scam.xyz', ip: '203.0.113.7', asn: 'AS64500' } }] })],
  [/otx\.alienvault\.com\/api\/v1\/indicators\/domain\/evil-paypa1\.top\/general/, () => json({ pulse_info: { count: 1, pulses: [{ id: 'abc123', name: 'Paypal phishing wave', indicator_count: 12 }] } })],
  [/otx\.alienvault\.com\/api\/v1\/indicators\/domain\/evil-paypa1\.top\/passive_dns/, () => json({ passive_dns: [{ address: '203.0.113.7', record_type: 'A' }] })],
];

test('response parsers', () => {
  assert.deepEqual(parseAnswers({ Status: 0, Answer: [{ name: 'a.', type: 2, data: 'NS1.X.COM.' }] }, 'NS'), ['ns1.x.com']);
  assert.equal(parseCymruOrigin('13335 | 1.1.1.0/24 | AU | apnic | 2011-08-11'), '13335');
  assert.deepEqual(parseRdap({ entities: [{ roles: ['registrar'], vcardArray: ['vcard', [['fn', {}, 'text', 'Reg Inc']]] }], nameservers: [{ ldhName: 'NS.A.COM' }], events: [{ eventAction: 'registration', eventDate: '2026-01-01' }] }), { registrar: 'Reg Inc', nameservers: ['ns.a.com'], registered: '2026-01-01' });
});

test('unseeded domain: live lookup fetches public data, stores it automatically and correlates', async () => {
  setListForTests('metamask-blocklist', ['evil-paypa1.top']);
  setListForTests('openphish', []);
  const restore = mockInternet(GOOD);
  try {
    const { s, a } = await world([], { cfg: live, collectors: DEFAULT_COLLECTORS });
    assert.equal(await a.graph.getNode('domain:evil-paypa1.top'), null); // empty database
    const r = await s.live.lookup('https://Evil-Paypa1.top/login');
    assert.equal(r.kind, 'domain');
    assert.equal(r.stored, true);
    assert.ok(r.sources.filter((x) => x.found).length >= 5, JSON.stringify(r.sources));
    const has = async (id: string) => (await a.graph.getNode(id)) !== null;
    for (const id of ['domain:evil-paypa1.top', 'ip:203.0.113.7', 'asn:64500', 'cert:183267-abc123', 'registrar:shady registrar llc', 'nameserver:ns1.badhost.example', 'blocklist:metamask-blocklist', 'report:otx:abc123', 'brand:paypal', 'domain:sibling-scam.xyz']) {
      assert.ok(await has(id), `missing ${id}`);
    }
    assert.equal(await s.live.needsEnrichment('domain:evil-paypa1.top'), false);
    assert.equal((await a.graph.getNode('domain:evil-paypa1.top'))?.meta.registered, '2026-10-01T00:00:00Z');
    await s.correlation.run();
    const inv = await s.investigation.investigate('evil-paypa1.top');
    assert.ok(inv.found && inv.flags.some((f) => f.type === 'blocklist') && inv.flags.some((f) => f.type === 'report'));
    assert.ok(inv.assessment.level === 'high' || inv.assessment.level === 'suspicious');
  } finally { restore(); }
});

test('nothing is stored when no public source knows the indicator', async () => {
  const restore = mockInternet([[/dns\.google/, () => json({ Status: 3 })], [/cloudflare-dns/, () => json({ Status: 3 })], [/./, () => new Response('{}', { status: 404 })]]);
  try {
    const { s, a } = await world([], { cfg: live, collectors: DEFAULT_COLLECTORS });
    const r = await s.live.lookup('does-not-exist-zzz.example');
    assert.equal(r.stored, false);
    assert.equal((await a.graph.stats()).edges, 0);
  } finally { restore(); }
});

test('bitcoin address lookup stores the wallet and its co-spending wallets', async () => {
  const addr = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
  const restore = mockInternet([
    [/mempool\.space\/api\/address\/[^/]+$/, () => json({ chain_stats: { tx_count: 4 }, mempool_stats: { tx_count: 0 } })],
    [/mempool\.space\/api\/address\/[^/]+\/txs/, () => json([{ vin: [{ prevout: { scriptpubkey_address: addr } }, { prevout: { scriptpubkey_address: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT' } }] }])],
  ]);
  try {
    const { s } = await world([], { cfg: live, collectors: DEFAULT_COLLECTORS });
    assert.equal((await s.live.lookup(addr)).stored, true);
    await s.correlation.run();
    const inv = await s.investigation.investigate(addr);
    assert.ok(inv.found && inv.clusters[0]?.size === 2);
  } finally { restore(); }
});

test('passive guard also checks every redirect hop', async () => {
  const restore = mockInternet([[/crt\.sh/, () => new Response(null, { status: 302, headers: { location: 'https://scam-target.example/steal' } })]]);
  try { await assert.rejects(() => safeFetch('https://crt.sh/?q=x'), /Blocked by passive-only guard/); } finally { restore(); }
  assert.equal(isAllowedUrl('https://rdap.verisign.com/com/v1/domain/x.com'), true);
  assert.equal(isAllowedUrl('https://evil.example/rdap.'), false);
});

test('certstream: only brand look-alike certificates are kept', () => {
  const msg = (domains: string[]) => JSON.stringify({ message_type: 'certificate_update', data: { leaf_cert: { all_domains: domains, sha256: 'AB'.repeat(32) } } });
  const hits = matchCertUpdate(msg(['*.paypa1-login.top', 'www.nice-bakery.com']), brands);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.domain, 'paypa1-login.top');
  assert.equal(matchCertUpdate(msg(['nice-bakery.com']), brands).length, 0);
  assert.equal(matchCertUpdate('garbage', brands).length, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBatch } from '../src/domain/buildBatch.ts';
import { detectIndicator } from '../src/domain/detect.ts';
import { detectBrand, levenshtein } from '../src/domain/typosquat.ts';
import { generateDataset } from '../src/domain/synthetic.ts';
import { isAllowedUrl, safeFetch } from '../src/infrastructure/net-guard.ts';
import { brands, daysAgo, world } from './helpers.ts';
import { evaluate } from '../scripts/evaluate.ts';

test('levenshtein distance', () => {
  assert.equal(levenshtein('paypal', 'paypal'), 0);
  assert.equal(levenshtein('paypal', 'paypa1'), 1);
  assert.equal(levenshtein('kitten', 'sitting'), 3);
});

test('typosquat detector flags look-alikes (short brands included) but not the genuine site', () => {
  assert.ok(brands.length > 80);
  assert.equal(detectBrand('paypa1-login.com', brands)?.brand, 'paypal');
  assert.equal(detectBrand('sbi-netbanking.top', brands)?.brand, 'sbi');
  assert.equal(detectBrand('phonepe-cashback.xyz', brands)?.brand, 'phonepe');
  assert.equal(detectBrand('paypal.com', brands), null);
  assert.equal(detectBrand('sbicard.com', brands), null);
  assert.equal(detectBrand('sbx.com', brands), null);
  assert.equal(detectBrand('example.com', brands), null);
});

test('detectIndicator recognises what was typed', () => {
  assert.deepEqual(detectIndicator('https://Evil-Paypa1.top/login?x=1'), { kind: 'domain', value: 'evil-paypa1.top' });
  assert.equal(detectIndicator('203.0.113.7').kind, 'ip');
  assert.equal(detectIndicator('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq').kind, 'btc');
  assert.equal(detectIndicator('0x' + 'ab'.repeat(20)).kind, 'eth');
  assert.equal(detectIndicator('a'.repeat(64)).kind, 'sha256');
  assert.equal(detectIndicator('UA-123456-1').kind, 'tracker');
  assert.equal(detectIndicator('not an indicator').kind, 'unknown');
});

test('buildBatch is pure and de-duplicates nodes and edges', () => {
  const b = buildBatch({ domain: 'A.example', ips: ['1.1.1.1', '1.1.1.1'], certs: ['c1'], wallets: ['w1'], registered: '2026-01-01' }, brands, '2026-10-01T00:00:00Z', 'id-1');
  assert.equal(new Set(b.nodes.map((n) => n.id)).size, b.nodes.length);
  assert.ok(b.nodes.some((n) => n.id === 'domain:a.example') && b.edges.some((e) => e.rel === 'solicits'));
  assert.deepEqual(b.meta, [{ id: 'domain:a.example', set: { registered: '2026-01-01' } }]);
  assert.equal(b.observation.id, 'id-1');
});

test('passive-only guard refuses hosts outside the allow-list', async () => {
  assert.equal(isAllowedUrl('https://crt.sh/?q=x'), true);
  assert.equal(isAllowedUrl('https://scam-target.example/'), false);
  await assert.rejects(() => safeFetch('https://scam-target.example/'), /Blocked by passive-only guard/);
});

test('assets sharing strong infrastructure are clustered; weak overlap is not', async () => {
  const { a } = await world([
    { domain: 'a.example', certs: ['c1'], trackers: ['UA-1-1'], ips: [{ ip: '1.1.1.1', asn: 'AS1' }] },
    { domain: 'b.example', certs: ['c1'], trackers: ['UA-1-1'] },
    { domain: 'c.example', ips: [{ ip: '9.9.9.9', asn: 'AS1' }] },
  ]);
  const c = await a.graph.clusterIdsOf(['domain:a.example', 'domain:b.example', 'domain:c.example']);
  assert.equal(c.get('domain:a.example'), c.get('domain:b.example'));
  assert.notEqual(c.get('domain:a.example'), c.get('domain:c.example'));
});

test('hub infrastructure shared by too many assets is ignored', async () => {
  const { a } = await world(Array.from({ length: 60 }, (_, i) => ({ domain: `d${i}.example`, ips: ['5.5.5.5'], certs: [`x${i}`] })));
  const c = await a.graph.clusterIdsOf(['domain:d0.example', 'domain:d1.example']);
  assert.notEqual(c.get('domain:d0.example'), c.get('domain:d1.example'));
});

test('cross-vector link: domain <-> wallet <-> apk end up in one cluster', async () => {
  const sha = 'ab'.repeat(32);
  const { a } = await world([{ domain: 'scam.example', wallets: ['bc1qaaaa'] }, { apk: { sha256: sha, signer_sha256: 'cd'.repeat(32), wallets: ['bc1qaaaa'] } }]);
  const c = await a.graph.clusterIdsOf(['domain:scam.example', 'wallet:bc1qaaaa', `apk:${sha}`]);
  assert.equal(new Set(c.values()).size, 1);
});

test('investigate returns graph, summary, verdict and evidence without network access', async () => {
  const { s } = await world([
    { domain: 'a.example', certs: ['c1'], trackers: ['UA-1-1'] },
    { domain: 'b.example', certs: ['c1'], trackers: ['UA-1-1'], wallets: ['bc1qbbbb'] },
  ]);
  const r = await s.investigation.investigate('A.Example');
  assert.ok(r.found);
  assert.equal(r.clusters.length, 1);
  assert.ok(r.graph.nodes.length >= 3 && r.graph.links.length >= 3 && r.evidence.length >= 1);
  assert.equal((await s.investigation.investigate('does-not-exist.example')).found, false);
});

test('verdict: official brands are never flagged; no signals is "none", never "safe"', async () => {
  const { s } = await world([{ domain: 'paypal.com', ips: ['1.1.1.1'] }, { domain: 'www.phonepe.com' }, { domain: 'nice-bakery.example', ips: ['3.3.3.3'] }]);
  const lvl = async (q: string) => { const r = await s.investigation.investigate(q); assert.ok(r.found); return r.assessment; };
  assert.equal((await lvl('paypal.com')).level, 'official');
  assert.equal((await lvl('www.phonepe.com')).level, 'official');
  assert.deepEqual((await lvl('nice-bakery.example')).reasons.map((r) => r.code), ['no_signals']);
});

test('verdict: blocklisted is high, look-alike alone suspicious, age counts only with other signals, shared platforms capped', async () => {
  const { s } = await world([
    { domain: 'bad-site.example', blocklists: ['openphish'] },
    { domain: 'phonepe-cashback.xyz', registered: daysAgo(5) },
    { domain: 'fresh-bakery.example', registered: daysAgo(3) },
    { domain: 'someone.github.io', blocklists: ['openphish'] },
  ]);
  const a = async (q: string) => { const r = await s.investigation.investigate(q); assert.ok(r.found); return r.assessment; };
  assert.equal((await a('bad-site.example')).level, 'high');
  const look = await a('phonepe-cashback.xyz');
  assert.equal(look.level, 'suspicious');
  assert.ok(look.reasons.some((r) => r.code === 'lookalike') && look.reasons.some((r) => r.code === 'new_domain'));
  assert.equal((await a('fresh-bakery.example')).level, 'none');
  const gh = await a('someone.github.io');
  assert.equal(gh.level, 'suspicious');
  assert.ok(gh.reasons.some((r) => r.code === 'shared_platform'));
});

test('verdict: assets linked to flagged infrastructure learn about it; unrelated ones do not', async () => {
  const { s } = await world([
    { domain: 'bad-one.example', blocklists: ['openphish'], certs: ['c1'], trackers: ['UA-9-1'], wallets: ['bc1qscam'] },
    { domain: 'mystery.example', certs: ['c1'], trackers: ['UA-9-1'] },
    { domain: 'unrelated-shop.example', ips: ['8.8.8.8'] },
  ]);
  const r = await s.investigation.investigate('mystery.example');
  assert.ok(r.found && r.assessment.reasons.some((x) => x.code === 'linked_flagged'));
  assert.ok(['suspicious', 'high'].includes(r.assessment.level));
  assert.equal(r.assets.find((x) => x.value === 'bc1qscam')?.assessment.level, 'suspicious');
  const u = await s.investigation.investigate('unrelated-shop.example');
  assert.ok(u.found && u.assessment.level === 'none');
});

test('searching infrastructure (an IP) summarises it; facts explain a domain; recent list shows flagged domains', async () => {
  const { s } = await world([
    { domain: 'a-bad.example', blocklists: ['openphish'], ips: [{ ip: '9.9.9.9', asn: 'AS1' }], certs: ['c9'], trackers: ['UA-5-5'], registrar: 'Reg Inc', nameservers: ['ns1.x.example'] },
    { domain: 'b-bad.example', ips: ['9.9.9.9'], certs: ['c9'], trackers: ['UA-5-5'] },
  ]);
  const ip = await s.investigation.investigate('9.9.9.9');
  assert.ok(ip.found && ip.assessment.level === 'info' && ip.assessment.reasons[0]?.code === 'infra_summary');
  const d = await s.investigation.investigate('a-bad.example');
  assert.ok(d.found);
  assert.deepEqual([d.facts?.ips, d.facts?.registrar, d.facts?.nameservers, d.facts?.blocklists], [['9.9.9.9'], 'reg inc', ['ns1.x.example'], ['openphish']]);
  assert.ok((await s.assessment.recentFlagged(10)).some((i) => i.value === 'a-bad.example'));
});

test('evaluation harness: synthetic data gives sensible accuracy and near-zero false positives', async () => {
  const res = await evaluate(generateDataset({ campaigns: 10, noise: 30, seed: 1 }));
  assert.ok(res.metrics.correlationAccuracyPct > 40, `accuracy ${res.metrics.correlationAccuracyPct}`);
  assert.ok(res.metrics.falsePositiveRatePct < 1, `fpr ${res.metrics.falsePositiveRatePct}`);
});

// The SAME behavioural contract is run against every storage adapter (Liskov Substitution).
// The in-memory adapter always runs. To also verify MongoDB:   MONGO_TEST_URL=mongodb://127.0.0.1:27017/osint_test npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBatch } from '../src/domain/buildBatch.ts';
import { correlate } from '../src/domain/correlate.ts';
import type { Adapters } from '../src/container.ts';
import { memoryAdapters } from '../src/container.ts';
import { brands } from './helpers.ts';

interface Factory { name: string; make: () => Promise<{ adapters: Adapters; close: () => Promise<void> }> }
const factories: Factory[] = [{ name: 'memory', make: async () => ({ adapters: memoryAdapters(), close: async () => undefined }) }];
if (process.env.MONGO_TEST_URL) {
  factories.push({
    name: 'mongodb', make: async () => {
      const modulePath = '../src/infrastructure/mongo/index.ts';
      const m = (await import(modulePath)) as { connectMongo: (u: string) => Promise<{ adapters: Adapters; close: () => Promise<void> }>; dropDatabase: () => Promise<void> };
      const c = await m.connectMongo(process.env.MONGO_TEST_URL as string);
      await m.dropDatabase();
      return { adapters: c.adapters, close: async () => { await m.dropDatabase(); await c.close(); } };
    },
  });
}
const NOW = '2026-10-01T00:00:00.000Z';
const batch = (o: Parameters<typeof buildBatch>[0], id: string) => buildBatch(o, brands, NOW, id);

for (const f of factories) {
  test(`[${f.name}] graph store contract`, async () => {
    const { adapters: a, close } = await f.make();
    try {
      const g = a.graph;
      const b1 = batch({ domain: 'a.example', ips: [{ ip: '1.1.1.1', asn: 'AS1' }], certs: ['c1'], wallets: ['w1'], blocklists: ['openphish'], registered: '2026-09-01' }, 'o1');
      const b2 = batch({ domain: 'paypa1-login.top', certs: ['c1'] }, 'o2');
      const first = await g.applyBatches([b1, b2]);
      assert.ok(first[0]!.nodes > 0 && first[0]!.edges > 0);
      assert.deepEqual(await g.applyBatches([b1, b2]), [{ nodes: 0, edges: 0 }, { nodes: 0, edges: 0 }]);   // idempotent
      assert.equal((await g.getNode('domain:a.example'))?.meta.registered, '2026-09-01');
      assert.deepEqual((await g.getNodes(['domain:a.example', 'nope:x'])).map((n) => n.id), ['domain:a.example']);
      assert.equal(await g.getNode('nope:x'), null);
      assert.ok((await g.edgesTouching(['cert:c1'])).length >= 2);
      assert.deepEqual((await g.edgesFrom(['domain:a.example'], ['listed_in'])).map((e) => e.dst), ['blocklist:openphish']);
      assert.ok((await g.searchNodes('paypa1', 5)).some((n) => n.id === 'domain:paypa1-login.top'));
      assert.equal((await g.recentNodes('domain', 1))[0]?.value, 'paypa1-login.top');           // newest first
      assert.deepEqual(await g.domainsNeedingEnrichment('openphish', 5), ['a.example']);
      await g.mergeMeta('domain:a.example', { enriched_at: NOW });
      assert.deepEqual(await g.domainsNeedingEnrichment('openphish', 5), []);
      assert.equal((await g.getNode('domain:a.example'))?.meta.enriched_at, NOW);
      assert.deepEqual(await g.domainsOnAnyBlocklist(10), ['a.example']);
      assert.deepEqual(await g.topBrands(3), [{ brand: 'paypal', count: 1 }]);

      const snap = await g.snapshot();
      assert.equal(snap.types.get('domain:a.example'), 'domain');
      const out = correlate(snap, { threshold: 0.3 });
      await g.replaceAll(out);
      const cid = (await g.clusterIdsOf(['domain:a.example', 'domain:paypa1-login.top'])).get('domain:a.example') as string;
      assert.ok(cid);
      assert.ok((await g.members(cid)).includes('domain:a.example'));
      assert.equal((await g.summaries([cid]))[0]?.clusterId, cid);
      assert.ok((await g.topSummaries(5)).every((s) => s.riskScore !== null));
      const all = (await g.members(cid));
      assert.ok((await g.linksAmong(all, 10)).every((l) => all.includes(l.a) && all.includes(l.b)));
      const st = await g.stats();
      assert.ok(st.nodes.domain === 2 && st.edges > 0 && st.observations === 2);
    } finally { await close(); }
  });

  test(`[${f.name}] users, revoked tokens, model storage contract`, async () => {
    const { adapters: a, close } = await f.make();
    try {
      assert.equal(await a.users.count(), 0);
      const u = await a.users.create({ email: 'x@example.com', name: 'X', passwordHash: 'h', role: 'user' });
      assert.equal((await a.users.findByEmail('x@example.com'))?.id, u.id);
      assert.equal((await a.users.findById(u.id))?.name, 'X');
      assert.equal(await a.users.findById('not-an-id'), null);
      await assert.rejects(() => a.users.create({ email: 'x@example.com', name: 'Y', passwordHash: 'h', role: 'user' }));  // unique email
      assert.equal((await a.users.findByIds([u.id, 'zzz'])).length, 1);
      await a.users.touchLogin(u.id);
      assert.ok((await a.users.findById(u.id))?.lastLoginAt);
      await a.users.updatePassword(u.id, 'new-hash');
      assert.equal((await a.users.findById(u.id))?.passwordHash, 'new-hash');
      assert.equal(await a.revoked.isRevoked('jti-1'), false);
      await a.revoked.revoke('jti-1', new Date(Date.now() + 60_000));
      assert.equal(await a.revoked.isRevoked('jti-1'), true);
      const dummy = { name: 'domain-classifier', trainedAt: NOW, model: { featureNames: ['a'], mean: [0], std: [1], weights: [1], bias: 0 }, trainedOn: { source: 's', synthetic: true, positives: 1, negatives: 1 }, metrics: { train: {} as never, test: {} as never } };
      assert.equal((await a.models.save(dummy)).version, 1);
      assert.equal((await a.models.save(dummy)).version, 2);
      assert.equal((await a.models.latest('domain-classifier'))?.version, 2);
      assert.equal(await a.models.latest('other'), null);
    } finally { await close(); }
  });

  test(`[${f.name}] search history and analytics contract`, async () => {
    const { adapters: a, close } = await f.make();
    try {
      const s = a.searches;
      const mk = (userId: string, value: string, createdAt: string, level: 'high' | 'none' | null = 'none', live = false) =>
        s.add({ userId, query: value, value, kind: 'domain', found: level !== null, level, live, stored: false, latencyMs: 20, createdAt });
      const e1 = await mk('u1', 'a.top', '2026-10-24T10:00:00.000Z', 'high', true);
      await mk('u1', 'a.top', '2026-10-25T11:00:00.000Z', 'high');
      await mk('u1', 'b.top', '2026-10-25T12:00:00.000Z', null);
      await mk('u2', 'a.top', '2026-10-25T10:00:00.000Z', 'none');
      assert.deepEqual((await s.listByUser('u1', { limit: 10 })).map((e) => e.createdAt.slice(0, 13)), ['2026-10-25T12', '2026-10-25T11', '2026-10-24T10']);
      assert.equal((await s.listByUser('u1', { limit: 10, before: '2026-10-25T11:30:00.000Z' })).length, 2);
      const all = {}; const mine = { userId: 'u1' };
      assert.deepEqual(await s.totals(all), { searches: 4, users: 2, flagged: 2, live: 1, avgLatencyMs: 20 });
      assert.equal((await s.totals(mine)).searches, 3);
      assert.equal((await s.totals({ since: new Date('2026-10-25T00:00:00.000Z') })).searches, 3);
      assert.deepEqual((await s.topQueries(all, 1))[0], { value: 'a.top', kind: 'domain', count: 3 });
      assert.deepEqual(await s.perDay(all), [{ day: '2026-10-24', count: 1 }, { day: '2026-10-25', count: 3 }]);
      assert.deepEqual((await s.byLevel(all)).find((x) => x.key === 'notfound'), { key: 'notfound', count: 1 });
      assert.equal((await s.byKind(all))[0]?.count, 4);
      const hm = await s.heatmap(all);                                    // 2026-10-25 is a Sunday (row 0), 2026-10-24 a Saturday (row 6)
      assert.equal(hm[0]![10], 1); assert.equal(hm[0]![11], 1); assert.equal(hm[6]![10], 1);
      assert.deepEqual((await s.topUsers(all, 5))[0], { userId: 'u1', count: 3 });
      assert.equal(await s.deleteOne('u2', e1.id), false);                // not yours
      assert.equal(await s.deleteOne('u1', e1.id), true);
      assert.equal(await s.clearUser('u1'), 2);
    } finally { await close(); }
  });
}

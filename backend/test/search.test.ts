import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInsights, fillDays } from '../src/domain/analytics.ts';
import { extractFeatures, FEATURE_NAMES } from '../src/domain/ml/features.ts';
import { auc, predictProba, trainLogistic } from '../src/domain/ml/logistic.ts';
import { AppError } from '../src/domain/errors.ts';
import type { NewSearchEvent } from '../src/application/ports.ts';
import type { PublicUser } from '../src/domain/types.ts';
import { brands, world } from './helpers.ts';

const alice: PublicUser = { id: 'u-alice', email: 'a@example.com', name: 'Alice', role: 'user' };
const admin: PublicUser = { id: 'u-admin', email: 'admin@example.com', name: 'Admin', role: 'admin' };
const ev = (userId: string, value: string, createdAt: string, over: Partial<NewSearchEvent> = {}): NewSearchEvent =>
  ({ userId, query: value, value, kind: 'domain', found: true, level: 'none', live: false, stored: false, latencyMs: 10, createdAt, ...over });
const code = async (p: Promise<unknown>): Promise<string> => { try { await p; return 'ok'; } catch (e) { return e instanceof AppError ? e.code : 'other'; } };

test('a search is remembered in the searching user\'s history only', async () => {
  const { s } = await world([{ domain: 'bad.example', blocklists: ['openphish'] }]);
  const out = await s.search.search(alice, 'https://Bad.example/x');
  assert.equal(out.status, 200);
  assert.equal((await s.search.search(alice, 'nothing-here.example')).status, 404);
  await s.search.search(admin, 'bad.example');
  const mine = await s.history.list(alice.id);
  assert.equal(mine.length, 2);
  assert.deepEqual(mine.map((e) => [e.value, e.found, e.level]), [['nothing-here.example', false, null], ['bad.example', true, 'high']]);
  assert.equal((await s.history.list(admin.id)).length, 1);
});

test('history: delete one entry (only your own), clear all', async () => {
  const { s } = await world([{ domain: 'a.example' }]);
  await s.search.search(alice, 'a.example'); await s.search.search(admin, 'a.example');
  const [entry] = await s.history.list(alice.id);
  assert.equal(await code(s.history.remove(admin.id, entry!.id)), 'not_found');   // not yours
  await s.history.remove(alice.id, entry!.id);
  assert.equal((await s.history.list(alice.id)).length, 0);
  assert.equal(await s.history.clear(admin.id), 1);
});

test('unrecognised input is answered and recorded with the right message code', async () => {
  const { s } = await world();
  const r = await s.search.search(alice, 'hello world');
  assert.equal(r.status, 404);
  assert.equal(r.status === 404 && r.body.messageCode, 'unrecognised');
  assert.equal((await s.history.list(alice.id))[0]?.kind, 'unknown');
});

test('analytics: totals, top queries, per-day (zero-filled), heat map; a normal user sees only their own numbers', async () => {
  const { s, a } = await world();
  const day = (n: number, h = 10) => new Date(Date.UTC(2026, 9, 26 - n, h)).toISOString();
  const now = Date.UTC(2026, 9, 26, 12);
  for (const e of [
    ev('u-alice', 'paypa1.top', day(0), { level: 'high', live: true }), ev('u-alice', 'paypa1.top', day(0, 11), { level: 'high' }), ev('u-alice', 'ok.example', day(2)),
    ev('u-admin', 'paypa1.top', day(1), { level: 'high' }), ev('u-admin', 'bc1qxyz', day(1, 15), { kind: 'btc', level: 'suspicious' }),
  ]) await a.searches.add(e);
  const svc = new (s.analytics.constructor as new (...x: unknown[]) => typeof s.analytics)(a.searches, a.graph, a.users, { now: () => now });
  const mine = await svc.summary(alice, { scope: 'me', days: 7 });
  assert.equal(mine.totals.searches, 3);
  assert.deepEqual(mine.topQueries[0], { value: 'paypa1.top', kind: 'domain', count: 2 });
  assert.equal(mine.perDay.length, 7);
  assert.equal(mine.perDay[6]?.count, 2);                  // today
  assert.equal(mine.perDay[5]?.count, 0);                  // zero-filled gap
  assert.equal(mine.heatmap.flat().reduce((x, y) => x + y, 0), 3);
  assert.equal(await code(svc.summary(alice, { scope: 'all' })), 'forbidden');
  const all = await svc.summary(admin, { scope: 'all', days: 7 });
  assert.equal(all.totals.searches, 5);
  assert.equal(all.totals.users, 2);
  assert.equal(all.topQueries[0]?.count, 3);
  assert.equal(all.levels.find((x) => x.key === 'high')?.count, 3);
});

test('insights: spike, trend and flagged share are found automatically; no data says so', () => {
  const days = (counts: number[]) => counts.map((count, i) => ({ day: `2026-10-${String(i + 1).padStart(2, '0')}`, count }));
  const heat = Array.from({ length: 7 }, () => new Array<number>(24).fill(0)); (heat[2] as number[])[14] = 30;
  const totals = { searches: 40, users: 3, flagged: 10, live: 8, avgLatencyMs: 20 };
  const codes = buildInsights({ current: days([1, 1, 2, 1, 1, 30, 1]), previous: days([1, 1, 1, 1, 1, 1, 1]), totals, topQueries: [{ value: 'x.top', kind: 'domain', count: 9 }], heatmap: heat });
  assert.deepEqual(codes.map((i) => i.code), ['top_query', 'trend', 'flagged_share', 'peak_hour', 'spike', 'live_share']);
  assert.equal(codes.find((i) => i.code === 'peak_hour')?.params.hour, 14);
  assert.equal(codes.find((i) => i.code === 'flagged_share')?.params.pct, 25);
  assert.equal(buildInsights({ current: [], previous: [], totals: { ...totals, searches: 0 }, topQueries: [], heatmap: heat })[0]?.code, 'no_data');
  assert.equal(fillDays([{ day: '2026-10-26', count: 3 }], 3, Date.UTC(2026, 9, 26, 5)).map((d) => d.count).join(), '0,0,3');
});

test('ML: logistic regression separates separable data and its AUC is computed correctly', () => {
  const X: number[][] = []; const y: number[] = [];
  for (let i = 0; i < 200; i++) { X.push([i % 10, (i * 7) % 5, 0]); y.push(0); X.push([10 + (i % 10), 5 + ((i * 3) % 5), 1]); y.push(1); }
  const r = trainLogistic(X, y, ['a', 'b', 'c']);
  assert.ok(r.test.auc > 0.99 && r.test.accuracy > 0.95, JSON.stringify(r.test));
  assert.ok(predictProba(r.model, [18, 8, 1]) > 0.9 && predictProba(r.model, [1, 1, 0]) < 0.1);
  assert.equal(auc([0.1, 0.4, 0.35, 0.8], [0, 0, 1, 1]), 0.75);
});

test('ML features: look-alikes score high on brand similarity, ordinary names do not', () => {
  const look = extractFeatures('paypa1-secure-login.top', brands); const plain = extractFeatures('rajeshtraders.in', brands);
  const i = (n: string) => FEATURE_NAMES.indexOf(n as (typeof FEATURE_NAMES)[number]);
  assert.ok((look[i('brand_similarity')] as number) > (plain[i('brand_similarity')] as number));
  assert.equal(look[i('cheap_tld')], 1); assert.equal(plain[i('cheap_tld')], 0);
  assert.ok((look[i('phish_words')] as number) >= 2);
  assert.equal(look.length, FEATURE_NAMES.length);
});

test('ML service: trains the labelled demo model, persists it, scores look-alikes above ordinary domains, and refuses real training without labels', async () => {
  const { s, a } = await world();
  assert.equal(s.models.predict('paypa1-login.top'), null);              // no model yet
  const info = await s.models.train('synthetic');
  assert.equal(info.version, 1); assert.equal(info.trainedOn.synthetic, true);
  assert.ok(info.metrics.test.auc > 0.85, `AUC ${info.metrics.test.auc}`);
  assert.ok((s.models.predict('paypa1-secure-login.top') as number) > (s.models.predict('rajeshtraders.in') as number));
  assert.equal((await a.models.latest('domain-classifier'))?.version, 1);
  assert.equal(await code(s.models.train('graph')), 'not_enough_labels');
  assert.equal(await code(s.models.train('nope')), 'unknown_provider');
});

test('AI adds a modest warning to the verdict but can never flag a real brand or reach "suspicious" alone', async () => {
  const { s } = await world([{ domain: 'x-secure-login-verify1.top' }, { domain: 'paypal.com' }]);
  await s.models.train('synthetic');
  const bad = await s.investigation.investigate('x-secure-login-verify1.top');
  assert.ok(bad.found);
  if (bad.assessment.reasons.some((r) => r.code === 'ai_model')) assert.ok((bad.assessment.score ?? 0) <= 29);
  const real = await s.investigation.investigate('paypal.com');
  assert.ok(real.found && real.assessment.level === 'official');
});

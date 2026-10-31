import test from 'node:test';
import assert from 'node:assert/strict';
import { DICT, translate } from '../src/i18n.ts';
import { connectionText, strengthKey, esc, daysSince } from '../src/explain.ts';

const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();

test('English and Marathi have exactly the same keys and placeholders', () => {
  const en = Object.keys(DICT.en).sort(); const mr = Object.keys(DICT.mr).sort();
  assert.deepEqual(mr, en);
  for (const k of en) {
    const a = DICT.en[k as keyof typeof DICT.en]; const b = DICT.mr[k as keyof typeof DICT.mr];
    assert.deepEqual(placeholders(b), placeholders(a), `placeholders differ for ${k}`);
    if (a !== '') assert.notEqual(b, '', `Marathi text missing for ${k}`);
  }
});

test('Marathi text really is Marathi (Devanagari) where it should be', () => {
  for (const k of Object.keys(DICT.en) as Array<keyof typeof DICT.en>) {
    if (DICT.en[k] === '' || k === 'err.offline') continue; // err.offline contains a shell command
    assert.match(DICT.mr[k], /[\u0900-\u097F]/, `${k} has no Devanagari`);
  }
});

test('translate fills placeholders and degrades gracefully', () => {
  assert.equal(translate('en', 'reason.new_domain', { days: 5 }), 'Registered only 5 days ago.');
  assert.equal(translate('mr', 'reason.new_domain', { days: 5 }), 'केवळ 5 दिवसांपूर्वी नोंदणी झाली.');
  assert.equal(translate('en', 'no.such.key'), 'no.such.key');
  assert.equal(translate('en', 'summary.official'), 'This is a known official address of {brand}.'); // missing param stays visible
});

test('every connection kind the engine can produce has a sentence in both languages', () => {
  const types = ['cert', 'ip', 'nameserver', 'tracker', 'signer', 'package', 'wallet', 'apk', 'brand', 'report', 'registrar', 'asn', 'domain'];
  for (const t of types) { const { key } = connectionText({ via: `${t}:abc`, type: t, c: 0.5 }); assert.ok(key in DICT.en && key in DICT.mr, key); }
  for (const rel of ['solicits', 'distributed_from', 'embeds_wallet', 'co_spent', 'funded_by', 'whatever']) {
    const { key } = connectionText({ via: `direct:${rel}`, type: 'direct', c: 0.8 }); assert.ok(key in DICT.en && key in DICT.mr, key);
  }
  assert.equal(connectionText({ via: 'ip:203.0.113.7', type: 'ip', c: 0.4 }).params.value, '203.0.113.7');
});

test('all node types and relations the backend creates are translated', () => {
  const types = ['domain', 'wallet', 'apk', 'ip', 'cert', 'signer', 'tracker', 'package', 'nameserver', 'registrar', 'brand', 'asn', 'report', 'blocklist'];
  const rels = ['resolves_to', 'uses_cert', 'solicits', 'signed_by', 'has_package', 'embeds_tracker', 'distributed_from', 'embeds_wallet', 'registered_via', 'uses_ns', 'in_asn', 'impersonates', 'mentioned_in', 'listed_in', 'co_spent', 'funded_by'];
  for (const t of types) assert.ok(`type.${t}` in DICT.mr, t);
  for (const r of rels) assert.ok(`rel.${r}` in DICT.mr, r);
  for (const l of ['official', 'high', 'suspicious', 'signals', 'none', 'info']) assert.ok(`level.${l}` in DICT.mr && `summary.${l}` in DICT.mr, l);
});

test('helpers', () => {
  assert.equal(strengthKey(0.9), 'conn.strength.strong');
  assert.equal(strengthKey(0.75), 'conn.strength.moderate');
  assert.equal(strengthKey(0.61), 'conn.strength.possible');
  assert.equal(esc('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(daysSince('2026-10-07T00:00:00Z', Date.parse('2026-10-12T12:00:00Z')), 5);
});

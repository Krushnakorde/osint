import test from 'node:test';
import assert from 'node:assert/strict';
import { detectIndicator } from '../src/domain/detect.ts';
import { verifyEmail } from '../src/domain/emailVerify.ts';
import { verifyPhone } from '../src/domain/phoneVerify.ts';
import { analyzeMessage } from '../src/domain/smishing.ts';
import { buildChangeVector } from '../src/domain/changeVector.ts';
import type { NodeRecord } from '../src/domain/graph.ts';
import type { Brand, ClusterInfo, NodeRow } from '../src/domain/types.ts';

const brands: Brand[] = [
  { name: 'paypal', domains: ['paypal.com'] },
  { name: 'sbi', domains: ['sbi.co.in', 'onlinesbi.sbi'] },
];

test('detectIndicator recognises email, phone, and smishing messages', () => {
  assert.equal(detectIndicator('support@paypal-security.com').kind, 'email');
  assert.equal(detectIndicator('phish@tempmail.com').kind, 'email');
  assert.equal(detectIndicator('+919876543210').kind, 'phone');
  assert.equal(detectIndicator('9876543210').kind, 'phone');
  assert.equal(detectIndicator('VK-HDFCBK').kind, 'phone');

  const msg = 'Dear user, your SBI account is blocked immediately. Update KYC at http://sbi-pan-kyc.top or call +919876543210';
  assert.equal(detectIndicator(msg).kind, 'message');
});

test('emailVerify detects disposable domains, lookalikes and official domains', () => {
  const disp = verifyEmail('fraudster@tempmail.com', brands);
  assert.equal(disp.facts.isDisposable, true);
  assert.equal(disp.assessment.level, 'high');

  const lookalike = verifyEmail('help@paypa1-update.com', brands);
  assert.equal(lookalike.facts.impersonatesBrand, 'paypal');
  assert.equal(lookalike.assessment.level, 'suspicious');

  const official = verifyEmail('service@paypal.com', brands);
  assert.equal(official.assessment.level, 'official');
});

test('phoneVerify identifies TRAI headers, country codes, and VoIP flags', () => {
  const header = verifyPhone('VK-HDFCBK');
  assert.equal(header.facts.isOfficialHeader, true);
  assert.equal(header.assessment.level, 'official');

  const india = verifyPhone('+919876543210');
  assert.equal(india.facts.countryName, 'India');
  assert.equal(india.facts.countryCode, '+91');

  const voip = verifyPhone('+12025550199');
  assert.equal(voip.facts.isVoip, true);
  assert.equal(voip.assessment.level, 'suspicious');
});

test('analyzeMessage parses smishing texts, extracts URLs, phones and flags urgency', () => {
  const text = 'Urgent: Electricity power will be disconnected tonight at 9:30 PM. Update your bill immediately at http://power-bill-pay.com or contact +919876543210';
  const smish = analyzeMessage(text, '+919999988888');

  assert.equal(smish.isSmishing, true);
  assert.ok(smish.riskScore >= 50);
  assert.deepEqual(smish.extracted.domains, ['power-bill-pay.com']);
  assert.ok(smish.extracted.phones.includes('+919876543210'));
  assert.equal(smish.urgencyLevel, 'high');
  assert.ok(smish.threatIndicators.some((t) => t.includes('Urgency')));
});

test('buildChangeVector tracks active vectors, transitions, and infrastructure churn', () => {
  const start: NodeRow = { id: 'domain:scam.top', type: 'domain', value: 'scam.top' };
  const clusters: ClusterInfo[] = [
    { id: 'C-1', size: 4, vectors: ['web', 'mobile', 'crypto', 'telecom'], confidence: 0.85, risk_score: 80 },
  ];
  const edges = [
    { source: 'phone:+919876543210', target: 'domain:scam.top', rel: 'contacts_via' },
    { source: 'domain:scam.top', target: 'apk:sha123', rel: 'distributed_from' },
    { source: 'apk:sha123', target: 'wallet:bc1q123', rel: 'embeds_wallet' },
    { source: 'domain:scam.top', target: 'ip:1.2.3.4', rel: 'resolves_to' },
    { source: 'domain:scam.top', target: 'ip:5.6.7.8', rel: 'resolves_to' },
    { source: 'domain:scam.top', target: 'cert:certA', rel: 'uses_cert' },
    { source: 'domain:scam.top', target: 'cert:certB', rel: 'uses_cert' },
  ];
  const records = new Map<string, NodeRecord>([
    ['domain:scam.top', { id: 'domain:scam.top', type: 'domain', value: 'scam.top', firstSeen: '', meta: {} }],
    ['phone:+919876543210', { id: 'phone:+919876543210', type: 'phone', value: '+919876543210', firstSeen: '', meta: {} }],
    ['apk:sha123', { id: 'apk:sha123', type: 'apk', value: 'sha123', firstSeen: '', meta: {} }],
    ['wallet:bc1q123', { id: 'wallet:bc1q123', type: 'wallet', value: 'bc1q123', firstSeen: '', meta: {} }],
    ['ip:1.2.3.4', { id: 'ip:1.2.3.4', type: 'ip', value: '1.2.3.4', firstSeen: '', meta: {} }],
    ['ip:5.6.7.8', { id: 'ip:5.6.7.8', type: 'ip', value: '5.6.7.8', firstSeen: '', meta: {} }],
    ['cert:certA', { id: 'cert:certA', type: 'cert', value: 'certA', firstSeen: '', meta: {} }],
    ['cert:certB', { id: 'cert:certB', type: 'cert', value: 'certB', firstSeen: '', meta: {} }],
  ]);

  const cv = buildChangeVector(start, clusters, edges, records);
  assert.ok(cv.activeVectors.includes('web'));
  assert.ok(cv.activeVectors.includes('mobile'));
  assert.ok(cv.activeVectors.includes('crypto'));
  assert.ok(cv.activeVectors.includes('telecom'));
  assert.equal(cv.churn.ipMigrations, 2);
  assert.equal(cv.churn.certChanges, 2);
  assert.ok(cv.vectorTransitions.some((t) => t.includes('Web (Delivery Domain) ➔ Mobile')));
  assert.ok(cv.vectorTransitions.some((t) => t.includes('Mobile (Malware) ➔ Crypto')));
});

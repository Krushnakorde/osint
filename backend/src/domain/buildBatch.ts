import { nodeId, normalize } from './normalize.ts';
import { detectBrand } from './typosquat.ts';
import type { EdgeDoc, GraphBatch, NodeDoc } from './graph.ts';
import type { Brand, NodeType, Observation } from './types.ts';

/**
 * Pure function: observation -> the nodes/edges it implies. No I/O, so it is trivially testable and
 * works unchanged with any storage backend. See `Observation` in types.ts for the input shape.
 */
export function buildBatch(obs: Observation, brands: Brand[], nowIso: string, fallbackId: string): GraphBatch {
  const source = obs.source || 'unknown';
  const nodes = new Map<string, NodeDoc>();
  const edges = new Map<string, EdgeDoc>();
  const meta: GraphBatch['meta'] = [];

  const node = (type: NodeType, value: string | number): string => {
    const id = nodeId(type, value);
    if (!nodes.has(id)) nodes.set(id, { id, type, value: normalize(type, value), firstSeen: nowIso });
    return id;
  };
  const link = (src: string, dst: string, rel: string, weight = 1, evidence: string | null = null): void => {
    if (src === dst) return;
    const key = `${src}|${dst}|${rel}`;
    if (!edges.has(key)) edges.set(key, { src, dst, rel, weight, source, evidence, createdAt: nowIso });
  };

  const walletIds = (obs.wallets ?? []).map((w) => node('wallet', w));
  for (const wl of obs.wallet_links ?? []) {
    const o = Array.isArray(wl) ? { a: wl[0], b: wl[1] } : wl;
    link(node('wallet', o.a), node('wallet', o.b), o.rel ?? 'co_spent', o.weight ?? 1, 'wallet relationship');
  }

  const emailIds = (obs.emails ?? []).map((e) => {
    const eid = node('email', e);
    const domainPart = String(e).split('@')[1];
    if (domainPart) link(eid, node('domain', domainPart), 'hosted_on');
    return eid;
  });
  const phoneIds = (obs.phones ?? []).map((p) => node('phone', p));

  const d = obs.domain ? node('domain', obs.domain) : null;
  for (const ip of obs.ips ?? []) {
    const o = typeof ip === 'string' ? { ip } : ip;
    const i = node('ip', o.ip);
    if (d) link(d, i, 'resolves_to', 'weight' in o ? o.weight ?? 1 : 1);
    if ('asn' in o && o.asn) link(i, node('asn', o.asn), 'in_asn');
  }
  if (d && obs.domain) {
    const certIds = (obs.certs ?? []).map((c) => node('cert', c));
    for (const c of certIds) link(d, c, 'uses_cert');
    for (const s of obs.sans ?? []) { const sd = node('domain', s); for (const c of certIds) link(sd, c, 'uses_cert'); }
    if (obs.registrar) link(d, node('registrar', obs.registrar), 'registered_via');
    for (const ns of obs.nameservers ?? []) link(d, node('nameserver', ns), 'uses_ns');
    for (const t of obs.trackers ?? []) link(d, node('tracker', t), 'embeds_tracker');
    for (const w of walletIds) link(d, w, 'solicits');
    for (const em of emailIds) link(d, em, 'contacts_via');
    for (const ph of phoneIds) link(d, ph, 'contacts_via');
    for (const r of obs.reports ?? []) link(d, node('report', r), 'mentioned_in');
    for (const b of obs.blocklists ?? []) link(d, node('blocklist', b), 'listed_in');
    if (obs.registered) meta.push({ id: d, set: { registered: obs.registered } });
    const hit = detectBrand(normalize('domain', obs.domain), brands);
    if (hit) link(d, node('brand', hit.brand), 'impersonates', 1, `${hit.method}:${hit.distance}`);
  }

  if (obs.apk?.sha256) {
    const a = node('apk', obs.apk.sha256);
    if (obs.apk.signer_sha256) link(a, node('signer', obs.apk.signer_sha256), 'signed_by');
    if (obs.apk.package) link(a, node('package', obs.apk.package), 'has_package');
    for (const t of obs.apk.trackers ?? []) link(a, node('tracker', t), 'embeds_tracker');
    for (const h of obs.apk.hosted_on ?? []) link(a, node('domain', h), 'distributed_from');
    for (const w of obs.apk.wallets ?? []) link(a, node('wallet', w), 'embeds_wallet');
    for (const em of emailIds) link(a, em, 'contacts_via');
    for (const ph of phoneIds) link(a, ph, 'contacts_via');
  }
  return {
    nodes: [...nodes.values()], edges: [...edges.values()], meta,
    observation: { id: obs.id || fallbackId, source, payload: JSON.stringify(obs), ingestedAt: nowIso },
  };
}

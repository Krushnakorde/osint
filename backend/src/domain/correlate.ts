import crypto from 'node:crypto';
import { isAsset } from './normalize.ts';
import type { CorrelationOutput, LinkRecord, Snapshot } from './graph.ts';
import type { AssetType, Contribution, NodeType, Vector } from './types.ts';

export type WeightMap = Record<NodeType, number>;

/**
 * How much a SHARED node of each type says about "same operator".
 * Initial values are expert heuristics -- tuning/ablating them is part of the research (README section 10).
 */
export const BASE_WEIGHTS: WeightMap = {
  wallet: 0.90, apk: 0.90, signer: 0.85, tracker: 0.85, cert: 0.75, package: 0.50,
  ip: 0.45, nameserver: 0.35, brand: 0.30, report: 0.25, registrar: 0.15, asn: 0.10, domain: 0.10,
  blocklist: 0, // label only: being on the same public blocklist says nothing about a common operator
  email: 0.85, phone: 0.85,
};
export const DIRECT_WEIGHT = 0.85; // two assets named together in one report (domain<->wallet, apk<->domain, ...)
export const SPECIFICITY_K = 0.25; // penalises widely shared nodes: spec = 1 / (1 + K * ln(degree))

const vectorOf: Record<AssetType, Vector> = { domain: 'web', wallet: 'crypto', apk: 'mobile', email: 'email', phone: 'telecom' };

export interface CorrelateOptions { threshold?: number; maxHub?: number; weights?: Partial<WeightMap> }
interface Neighbour { other: string; w: number }

/** Pure function: graph snapshot in, clusters + links out. No storage involved. */
export function correlate(snapshot: Snapshot, opts: CorrelateOptions = {}): CorrelationOutput {
  const threshold = opts.threshold ?? 0.6;
  const maxHub = opts.maxHub ?? 50;
  const weights: WeightMap = { ...BASE_WEIGHTS, ...opts.weights };
  const { types: type, edges } = snapshot;

  const adj = new Map<string, Neighbour[]>();
  const push = (a: string, b: string, w: number): void => { const l = adj.get(a); if (l) l.push({ other: b, w }); else adj.set(a, [{ other: b, w }]); };
  for (const e of edges) { push(e.src, e.dst, e.weight); push(e.dst, e.src, e.weight); }

  const pairs = new Map<string, Contribution[]>();
  const add = (a: string, b: string, via: string, c: number): void => {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const contribution: Contribution = { via, type: type.get(via) ?? 'direct', c };
    const l = pairs.get(key);
    if (l) l.push(contribution); else pairs.set(key, [contribution]);
  };

  // 1) direct asset<->asset evidence
  for (const e of edges) if (isAsset(type.get(e.src)) && isAsset(type.get(e.dst))) add(e.src, e.dst, `direct:${e.rel}`, DIRECT_WEIGHT * e.weight);
  // 2) shared-neighbour evidence, discounted by how widely the neighbour is shared
  for (const [n, list] of adj) {
    const assets = [...new Map(list.filter((x) => isAsset(type.get(x.other)) && x.other !== n).map((x): [string, number] => [x.other, x.w])).entries()];
    if (assets.length < 2 || assets.length > maxHub) continue; // hubs (CDNs, debug signing key...) carry no signal
    const t = type.get(n);
    const base = (t ? weights[t] : undefined) ?? 0.1;
    if (base === 0) continue;
    const spec = 1 / (1 + SPECIFICITY_K * Math.log(assets.length));
    for (let i = 0; i < assets.length; i++) for (let j = i + 1; j < assets.length; j++) {
      const [ai, wi] = assets[i]!; const [aj, wj] = assets[j]!;
      add(ai, aj, n, base * spec * Math.min(wi, wj));
    }
  }

  // 3) noisy-OR combine, keep pairs above the threshold, union-find clusters
  const parent = new Map<string, string>();
  const find = (x: string): string => { while (parent.get(x) !== x) { const p = parent.get(x)!; parent.set(x, parent.get(p)!); x = parent.get(x)!; } return x; };
  for (const [id, t] of type) if (isAsset(t)) parent.set(id, id);
  const links: LinkRecord[] = [];
  for (const [key, contribs] of pairs) {
    const score = 1 - contribs.reduce((p, x) => p * (1 - x.c), 1);
    if (score < threshold) continue;
    const [a, b] = key.split('|') as [string, string];
    parent.set(find(a), find(b));
    contribs.sort((x, y) => y.c - x.c);
    links.push({ a, b, score, evidence: contribs.slice(0, 6).map((x) => ({ via: x.via, type: x.type, c: +x.c.toFixed(3) })) });
  }

  const groups = new Map<string, string[]>();
  for (const id of parent.keys()) { const r = find(id); const g = groups.get(r); if (g) g.push(id); else groups.set(r, [id]); }
  const scoresByRoot = new Map<string, number[]>();
  for (const l of links) { const r = find(l.a); const s = scoresByRoot.get(r); if (s) s.push(l.score); else scoresByRoot.set(r, [l.score]); }

  const summaries: CorrelationOutput['summaries'] = [];
  const memberships: CorrelationOutput['memberships'] = [];
  for (const [root, members] of groups) {
    members.sort();
    const clusterId = 'C-' + crypto.createHash('sha1').update(members.join(',')).digest('hex').slice(0, 8);
    const vectors = [...new Set(members.map((m) => vectorOf[type.get(m) as AssetType]))].sort();
    const scores = scoresByRoot.get(root) ?? [];
    const confidence = scores.length ? scores.reduce((s, x) => s + x, 0) / scores.length : null;
    const riskScore = confidence === null ? null : Math.round(100 * Math.min(1, confidence * (1 + 0.05 * (vectors.length - 1))));
    summaries.push({ clusterId, size: members.length, vectors, confidence, riskScore });
    for (const m of members) memberships.push([m, clusterId]);
  }
  return { memberships, summaries, links };
}

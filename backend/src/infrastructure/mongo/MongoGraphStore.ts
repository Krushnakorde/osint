import type { GraphStore } from '../../application/ports.ts';
import type { ClusterSummaryRecord, CorrelationOutput, EdgeRecord, GraphBatch, LinkRecord, NodeRecord, Snapshot } from '../../domain/graph.ts';
import type { Contribution, IngestStats, NodeRow, NodeType, Stats, Vector } from '../../domain/types.ts';
import { ClusterMemberModel, ClusterSummaryModel, EdgeModel, LinkModel, NodeModel, ObservationModel } from './models.ts';

interface NodeLean { _id: string; type: NodeType; value: string; firstSeen: string; meta?: Record<string, unknown> }
interface EdgeLean { src: string; dst: string; rel: string; weight: number; evidence: string | null }
interface SummaryLean { _id: string; size: number; vectors: Vector[]; confidence: number | null; riskScore: number | null }
const toNode = (n: NodeLean): NodeRecord => ({ id: n._id, type: n.type, value: n.value, firstSeen: n.firstSeen, meta: n.meta ?? {} });
const toEdge = (e: EdgeLean): EdgeRecord => ({ src: e.src, dst: e.dst, rel: e.rel, weight: e.weight, evidence: e.evidence ?? null });
const toSummary = (s: SummaryLean): ClusterSummaryRecord => ({ clusterId: s._id, size: s.size, vectors: s.vectors, confidence: s.confidence ?? null, riskScore: s.riskScore ?? null });
const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const chunk = <T>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** MongoDB adapter for the graph. Every method mirrors MemoryGraphStore (both are meant to pass test/contract.test.ts). */
export class MongoGraphStore implements GraphStore {
  async applyBatches(batches: GraphBatch[]): Promise<IngestStats[]> {
    const out: IngestStats[] = [];
    for (const b of batches) {
      const stats: IngestStats = { nodes: 0, edges: 0 };
      // $setOnInsert = "create if missing, never overwrite": the same semantics as the in-memory store
      if (b.nodes.length) {
        const r = await NodeModel.bulkWrite(b.nodes.map((n) => ({ updateOne: { filter: { _id: n.id }, update: { $setOnInsert: { type: n.type, value: n.value, firstSeen: n.firstSeen, meta: {} } }, upsert: true } })), { ordered: false });
        stats.nodes = r.upsertedCount;
      }
      if (b.edges.length) {
        const r = await EdgeModel.bulkWrite(b.edges.map((e) => ({ updateOne: { filter: { _id: `${e.src}|${e.dst}|${e.rel}` }, update: { $setOnInsert: { src: e.src, dst: e.dst, rel: e.rel, weight: e.weight, source: e.source, evidence: e.evidence, createdAt: e.createdAt } }, upsert: true } })), { ordered: false });
        stats.edges = r.upsertedCount;
      }
      for (const m of b.meta) await this.mergeMeta(m.id, m.set);
      await ObservationModel.updateOne({ _id: b.observation.id }, { $setOnInsert: { source: b.observation.source, payload: b.observation.payload, ingestedAt: b.observation.ingestedAt } }, { upsert: true });
      out.push(stats);
    }
    return out;
  }
  async mergeMeta(id: string, patch: Record<string, unknown>): Promise<void> {
    const set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) set[`meta.${k}`] = v;
    await NodeModel.updateOne({ _id: id }, { $set: set });
  }

  async getNode(id: string): Promise<NodeRecord | null> { const n = (await NodeModel.findById(id).lean()) as unknown as NodeLean | null; return n ? toNode(n) : null; }
  async getNodes(ids: string[]): Promise<NodeRecord[]> {
    if (!ids.length) return [];
    return ((await NodeModel.find({ _id: { $in: ids } }).lean()) as unknown as NodeLean[]).map(toNode);
  }
  async searchNodes(fragment: string, limit: number): Promise<NodeRow[]> {
    const rows = (await NodeModel.find({ value: { $regex: escapeRegex(fragment) } }).limit(limit).lean()) as unknown as NodeLean[];
    return rows.map((n) => ({ id: n._id, type: n.type, value: n.value }));
  }
  async edgesTouching(ids: string[]): Promise<EdgeRecord[]> {
    const out: EdgeRecord[] = [];
    for (const part of chunk(ids, 1000)) {
      out.push(...((await EdgeModel.find({ $or: [{ src: { $in: part } }, { dst: { $in: part } }] }).lean()) as unknown as EdgeLean[]).map(toEdge));
    }
    return [...new Map(out.map((e) => [`${e.src}|${e.dst}|${e.rel}`, e])).values()];
  }
  async edgesFrom(ids: string[], rels?: readonly string[]): Promise<EdgeRecord[]> {
    const out: EdgeRecord[] = [];
    for (const part of chunk(ids, 1000)) {
      const filter: Record<string, unknown> = { src: { $in: part } };
      if (rels) filter.rel = { $in: [...rels] };
      out.push(...((await EdgeModel.find(filter).lean()) as unknown as EdgeLean[]).map(toEdge));
    }
    return out;
  }
  async recentNodes(type: NodeType, limit: number): Promise<NodeRecord[]> {
    return ((await NodeModel.find({ type }).sort({ firstSeen: -1, _id: -1 }).limit(limit).lean()) as unknown as NodeLean[]).map(toNode);
  }
  async domainsNeedingEnrichment(blocklist: string, limit: number): Promise<string[]> {
    const edges = (await EdgeModel.find({ dst: `blocklist:${blocklist}`, rel: 'listed_in' }).select('src').lean()) as unknown as Array<{ src: string }>;
    if (!edges.length) return [];
    const rows = (await NodeModel.find({ _id: { $in: edges.map((e) => e.src) }, 'meta.enriched_at': { $exists: false } }).sort({ firstSeen: -1, _id: -1 }).limit(limit).lean()) as unknown as NodeLean[];
    return rows.map((n) => n.value);
  }
  async domainsOnAnyBlocklist(limit: number): Promise<string[]> {
    const edges = (await EdgeModel.find({ rel: 'listed_in' }).select('src').limit(limit * 3).lean()) as unknown as Array<{ src: string }>;
    const ids = [...new Set(edges.map((e) => e.src))].slice(0, limit);
    return ids.length ? ((await NodeModel.find({ _id: { $in: ids } }).select('value').lean()) as unknown as NodeLean[]).map((n) => n.value) : [];
  }

  /** Loads the whole graph for correlation. Fine for research-scale data; stream with a cursor if it grows to millions. */
  async snapshot(): Promise<Snapshot> {
    const nodes = (await NodeModel.find({}, { type: 1 }).lean()) as unknown as Array<{ _id: string; type: NodeType }>;
    const edges = (await EdgeModel.find({}, { src: 1, dst: 1, rel: 1, weight: 1, evidence: 1 }).lean()) as unknown as EdgeLean[];
    return { types: new Map(nodes.map((n) => [n._id, n.type])), edges: edges.map(toEdge) };
  }
  /** Not atomic (a transaction needs a replica set); readers may briefly see a partial result while it runs. */
  async replaceAll(out: CorrelationOutput): Promise<void> {
    await Promise.all([ClusterMemberModel.deleteMany({}), ClusterSummaryModel.deleteMany({}), LinkModel.deleteMany({})]);
    for (const part of chunk(out.memberships, 5000)) await ClusterMemberModel.insertMany(part.map(([id, clusterId]) => ({ _id: id, clusterId })), { ordered: false });
    for (const part of chunk(out.summaries, 5000)) await ClusterSummaryModel.insertMany(part.map((s) => ({ _id: s.clusterId, size: s.size, vectors: s.vectors, confidence: s.confidence, riskScore: s.riskScore })), { ordered: false });
    for (const part of chunk(out.links, 5000)) await LinkModel.insertMany(part, { ordered: false });
  }
  async clusterIdsOf(nodeIds: string[]): Promise<Map<string, string>> {
    if (!nodeIds.length) return new Map();
    const rows = (await ClusterMemberModel.find({ _id: { $in: nodeIds } }).lean()) as unknown as Array<{ _id: string; clusterId: string }>;
    return new Map(rows.map((r) => [r._id, r.clusterId]));
  }
  async members(clusterId: string): Promise<string[]> {
    return ((await ClusterMemberModel.find({ clusterId }).select('_id').lean()) as unknown as Array<{ _id: string }>).map((r) => r._id);
  }
  async summaries(clusterIds: string[]): Promise<ClusterSummaryRecord[]> {
    if (!clusterIds.length) return [];
    return ((await ClusterSummaryModel.find({ _id: { $in: clusterIds } }).lean()) as unknown as SummaryLean[]).map(toSummary);
  }
  async topSummaries(limit: number): Promise<ClusterSummaryRecord[]> {
    return ((await ClusterSummaryModel.find({ riskScore: { $ne: null } }).sort({ riskScore: -1, size: -1 }).limit(limit).lean()) as unknown as SummaryLean[]).map(toSummary);
  }
  async linksAmong(memberIds: string[], limit: number): Promise<LinkRecord[]> {
    if (!memberIds.length) return [];
    const rows = (await LinkModel.find({ a: { $in: memberIds }, b: { $in: memberIds } }).sort({ score: -1 }).limit(limit).lean()) as unknown as Array<{ a: string; b: string; score: number; evidence: Contribution[] }>;
    return rows.map((l) => ({ a: l.a, b: l.b, score: l.score, evidence: l.evidence }));
  }

  async stats(): Promise<Stats> {
    const byType = (await NodeModel.aggregate([{ $group: { _id: '$type', c: { $sum: 1 } } }])) as Array<{ _id: string; c: number }>;
    const [edges, observations, clusters, correlated] = await Promise.all([
      EdgeModel.estimatedDocumentCount(), ObservationModel.estimatedDocumentCount(), ClusterSummaryModel.estimatedDocumentCount(),
      ClusterSummaryModel.countDocuments({ riskScore: { $ne: null } }),
    ]);
    return { nodes: Object.fromEntries(byType.map((r) => [r._id, r.c])), edges, observations, clusters, correlatedClusters: correlated };
  }
  async topBrands(limit: number): Promise<Array<{ brand: string; count: number }>> {
    const rows = (await EdgeModel.aggregate([{ $match: { rel: 'impersonates' } }, { $group: { _id: '$dst', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: limit }])) as Array<{ _id: string; count: number }>;
    return rows.map((r) => ({ brand: r._id.slice(r._id.indexOf(':') + 1), count: r.count }));
  }
}

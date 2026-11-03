/**
 * ============================================================================
 * MODULE: MongoDB Graph Store Adapter (Database Driver)
 * FILE: backend/src/infrastructure/mongo/MongoGraphStore.ts
 * ============================================================================
 *
 * WHAT THIS FILE DOES:
 * -------------------
 * This class implements the `GraphStore` port defined in `backend/src/application/ports.ts`.
 * It provides the concrete MongoDB persistence layer for storing and querying:
 * - Graph Nodes (indicators, infrastructure, brands, certificates).
 * - Graph Edges (relationships with weights and forensic provenance).
 * - Cluster Memberships & Summaries (syndicate rings detected by Algorithm 9.1).
 * - Pairwise Link Evidence between assets.
 * - Graph Ingestion Batches and Aggregation Statistics.
 *
 * DESIGN PATTERNS & BEST PRACTICES:
 * ---------------------------------
 * 1. Port & Adapter (Hexagonal Architecture):
 *    The core domain and application services never talk directly to Mongoose.
 *    They communicate through the `GraphStore` interface. This allows swapping
 *    between `MongoGraphStore` and `MemoryGraphStore` without touching business logic.
 *
 * 2. High-Performance Bulk Operations:
 *    Instead of individual inserts (which create massive network round-trips),
 *    this store uses `bulkWrite()` with unordered execution.
 *
 * 3. Idempotent Upserts ($setOnInsert):
 *    When re-ingesting a domain or edge, `$setOnInsert` ensures properties like
 *    `firstSeen` and `createdAt` are never overwritten by later observations.
 *
 * 4. Memory-Safe Chunking:
 *    Bulk array operations are segmented into chunks of 1,000 to 5,000 items
 *    to prevent running into MongoDB's 16MB BSON wire protocol limit.
 * ============================================================================
 */

import type { GraphStore } from '../../application/ports.ts';
import type {
  ClusterSummaryRecord,
  CorrelationOutput,
  EdgeRecord,
  GraphBatch,
  LinkRecord,
  NodeRecord,
  Snapshot,
} from '../../domain/graph.ts';
import type {
  Contribution,
  IngestStats,
  NodeRow,
  NodeType,
  Stats,
  Vector,
} from '../../domain/types.ts';
import {
  ClusterMemberModel,
  ClusterSummaryModel,
  EdgeModel,
  LinkModel,
  NodeModel,
  ObservationModel,
} from './models.ts';

/** Lean representation of a MongoDB Node document (skips Mongoose hydration overhead) */
interface NodeLean {
  _id: string;
  type: NodeType;
  value: string;
  firstSeen: string;
  meta?: Record<string, unknown>;
}

/** Lean representation of a MongoDB Edge document */
interface EdgeLean {
  src: string;
  dst: string;
  rel: string;
  weight: number;
  evidence: string | null;
}

/** Lean representation of a MongoDB Cluster Summary document */
interface SummaryLean {
  _id: string;
  size: number;
  vectors: Vector[];
  confidence: number | null;
  riskScore: number | null;
}

/** Mapping helpers from raw database rows to domain entities */
const toNode = (n: NodeLean): NodeRecord => ({
  id: n._id,
  type: n.type,
  value: n.value,
  firstSeen: n.firstSeen,
  meta: n.meta ?? {},
});

const toEdge = (e: EdgeLean): EdgeRecord => ({
  src: e.src,
  dst: e.dst,
  rel: e.rel,
  weight: e.weight,
  evidence: e.evidence ?? null,
});

const toSummary = (s: SummaryLean): ClusterSummaryRecord => ({
  clusterId: s._id,
  size: s.size,
  vectors: s.vectors,
  confidence: s.confidence ?? null,
  riskScore: s.riskScore ?? null,
});

/** Safely escapes special regex characters in user search input to prevent ReDoS */
const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Splits an array into smaller chunks of maximum size `n` */
const chunk = <T>(a: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/**
 * Concrete MongoDB implementation of the GraphStore port.
 */
export class MongoGraphStore implements GraphStore {
  /**
   * Ingests batches of graph data into MongoDB atomically and idempotently.
   *
   * @param batches Array of graph ingestion batches.
   * @returns Ingestion statistics (count of new nodes and edges created).
   */
  async applyBatches(batches: GraphBatch[]): Promise<IngestStats[]> {
    const out: IngestStats[] = [];

    for (const b of batches) {
      const stats: IngestStats = { nodes: 0, edges: 0 };

      // 1. Bulk Upsert Nodes: $setOnInsert creates only if node does not exist
      if (b.nodes.length) {
        const r = await NodeModel.bulkWrite(
          b.nodes.map((n) => ({
            updateOne: {
              filter: { _id: n.id },
              update: {
                $setOnInsert: {
                  type: n.type,
                  value: n.value,
                  firstSeen: n.firstSeen,
                  meta: {},
                },
              },
              upsert: true,
            },
          })),
          { ordered: false }
        );
        stats.nodes = r.upsertedCount;
      }

      // 2. Bulk Upsert Edges: Composite key "src|dst|rel" ensures idempotent relationships
      if (b.edges.length) {
        const r = await EdgeModel.bulkWrite(
          b.edges.map((e) => ({
            updateOne: {
              filter: { _id: `${e.src}|${e.dst}|${e.rel}` },
              update: {
                $setOnInsert: {
                  src: e.src,
                  dst: e.dst,
                  rel: e.rel,
                  weight: e.weight,
                  source: e.source,
                  evidence: e.evidence,
                  createdAt: e.createdAt,
                },
              },
              upsert: true,
            },
          })),
          { ordered: false }
        );
        stats.edges = r.upsertedCount;
      }

      // 3. Merge enriched metadata attributes
      for (const m of b.meta) {
        await this.mergeMeta(m.id, m.set);
      }

      // 4. Save raw observation for audit trail
      await ObservationModel.updateOne(
        { _id: b.observation.id },
        {
          $setOnInsert: {
            source: b.observation.source,
            payload: b.observation.payload,
            ingestedAt: b.observation.ingestedAt,
          },
        },
        { upsert: true }
      );

      out.push(stats);
    }
    return out;
  }

  /**
   * Merges partial metadata key-value pairs into a node's `meta` dictionary.
   */
  async mergeMeta(id: string, patch: Record<string, unknown>): Promise<void> {
    const set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      set[`meta.${k}`] = v;
    }
    await NodeModel.updateOne({ _id: id }, { $set: set });
  }

  /** Retrieves a single node record by its primary key ID. */
  async getNode(id: string): Promise<NodeRecord | null> {
    const n = (await NodeModel.findById(id).lean()) as unknown as NodeLean | null;
    return n ? toNode(n) : null;
  }

  /** Retrieves multiple node records in a single database query. */
  async getNodes(ids: string[]): Promise<NodeRecord[]> {
    if (!ids.length) return [];
    return ((await NodeModel.find({ _id: { $in: ids } }).lean()) as unknown as NodeLean[]).map(
      toNode
    );
  }

  /** Searches for nodes whose values match a substring (case-insensitive search). */
  async searchNodes(fragment: string, limit: number): Promise<NodeRow[]> {
    const rows = (await NodeModel.find({
      value: { $regex: escapeRegex(fragment) },
    })
      .limit(limit)
      .lean()) as unknown as NodeLean[];
    return rows.map((n) => ({ id: n._id, type: n.type, value: n.value }));
  }

  /**
   * Finds all edges where the given IDs appear as either source OR destination.
   * Processes large lists in safe 1,000-item chunks.
   */
  async edgesTouching(ids: string[]): Promise<EdgeRecord[]> {
    const out: EdgeRecord[] = [];
    for (const part of chunk(ids, 1000)) {
      out.push(
        ...(
          (await EdgeModel.find({
            $or: [{ src: { $in: part } }, { dst: { $in: part } }],
          }).lean()) as unknown as EdgeLean[]
        ).map(toEdge)
      );
    }
    // De-duplicate edges by composite key
    return [...new Map(out.map((e) => [`${e.src}|${e.dst}|${e.rel}`, e])).values()];
  }

  /** Retrieves directed outbound edges originating from specified source IDs. */
  async edgesFrom(ids: string[], rels?: readonly string[]): Promise<EdgeRecord[]> {
    const out: EdgeRecord[] = [];
    for (const part of chunk(ids, 1000)) {
      const filter: Record<string, unknown> = { src: { $in: part } };
      if (rels) filter.rel = { $in: [...rels] };
      out.push(
        ...((await EdgeModel.find(filter).lean()) as unknown as EdgeLean[]).map(toEdge)
      );
    }
    return out;
  }

  /** Retrieves the most recently discovered nodes of a given type. */
  async recentNodes(type: NodeType, limit: number): Promise<NodeRecord[]> {
    return (
      (await NodeModel.find({ type })
        .sort({ firstSeen: -1, _id: -1 })
        .limit(limit)
        .lean()) as unknown as NodeLean[]
    ).map(toNode);
  }

  /** Finds domains listed in threat feeds that have not yet had passive DNS/RDAP enrichment. */
  async domainsNeedingEnrichment(blocklist: string, limit: number): Promise<string[]> {
    const edges = (await EdgeModel.find({
      dst: `blocklist:${blocklist}`,
      rel: 'listed_in',
    })
      .select('src')
      .lean()) as unknown as Array<{ src: string }>;

    if (!edges.length) return [];

    const rows = (await NodeModel.find({
      _id: { $in: edges.map((e) => e.src) },
      'meta.enriched_at': { $exists: false },
    })
      .sort({ firstSeen: -1, _id: -1 })
      .limit(limit)
      .lean()) as unknown as NodeLean[];

    return rows.map((n) => n.value);
  }

  /** Finds domains active across any threat intelligence blocklist. */
  async domainsOnAnyBlocklist(limit: number): Promise<string[]> {
    const edges = (await EdgeModel.find({ rel: 'listed_in' })
      .select('src')
      .limit(limit * 3)
      .lean()) as unknown as Array<{ src: string }>;

    const ids = [...new Set(edges.map((e) => e.src))].slice(0, limit);
    return ids.length
      ? (
          (await NodeModel.find({ _id: { $in: ids } })
            .select('value')
            .lean()) as unknown as NodeLean[]
        ).map((n) => n.value)
      : [];
  }

  /**
   * Captures a complete graph snapshot for in-memory syndicate correlation (Algorithm 9.1).
   */
  async snapshot(): Promise<Snapshot> {
    const nodes = (await NodeModel.find(
      {},
      { type: 1 }
    ).lean()) as unknown as Array<{ _id: string; type: NodeType }>;

    const edges = (await EdgeModel.find(
      {},
      { src: 1, dst: 1, rel: 1, weight: 1, evidence: 1 }
    ).lean()) as unknown as EdgeLean[];

    return {
      types: new Map(nodes.map((n) => [n._id, n.type])),
      edges: edges.map(toEdge),
    };
  }

  /**
   * Atomically replaces the current cluster partition tables with newly computed syndicate clusters.
   */
  async replaceAll(out: CorrelationOutput): Promise<void> {
    // 1. Purge old correlation tables
    await Promise.all([
      ClusterMemberModel.deleteMany({}),
      ClusterSummaryModel.deleteMany({}),
      LinkModel.deleteMany({}),
    ]);

    // 2. Insert new cluster memberships in safe chunks
    for (const part of chunk(out.memberships, 5000)) {
      await ClusterMemberModel.insertMany(
        part.map(([id, clusterId]) => ({ _id: id, clusterId })),
        { ordered: false }
      );
    }

    // 3. Insert cluster summaries
    for (const part of chunk(out.summaries, 5000)) {
      await ClusterSummaryModel.insertMany(
        part.map((s) => ({
          _id: s.clusterId,
          size: s.size,
          vectors: s.vectors,
          confidence: s.confidence,
          riskScore: s.riskScore,
        })),
        { ordered: false }
      );
    }

    // 4. Insert pairwise bipartite links
    for (const part of chunk(out.links, 5000)) {
      await LinkModel.insertMany(part, { ordered: false });
    }
  }

  /** Returns a map from node ID to its syndicate cluster ID. */
  async clusterIdsOf(nodeIds: string[]): Promise<Map<string, string>> {
    if (!nodeIds.length) return new Map();
    const rows = (await ClusterMemberModel.find({
      _id: { $in: nodeIds },
    }).lean()) as unknown as Array<{ _id: string; clusterId: string }>;
    return new Map(rows.map((r) => [r._id, r.clusterId]));
  }

  /** Returns all member node IDs belonging to a given cluster ID. */
  async members(clusterId: string): Promise<string[]> {
    return (
      (await ClusterMemberModel.find({ clusterId })
        .select('_id')
        .lean()) as unknown as Array<{ _id: string }>
    ).map((r) => r._id);
  }

  /** Retrieves summary intelligence records for specified cluster IDs. */
  async summaries(clusterIds: string[]): Promise<ClusterSummaryRecord[]> {
    if (!clusterIds.length) return [];
    return (
      (await ClusterSummaryModel.find({
        _id: { $in: clusterIds },
      }).lean()) as unknown as SummaryLean[]
    ).map(toSummary);
  }

  /** Retrieves top clusters ranked by threat risk score. */
  async topSummaries(limit: number): Promise<ClusterSummaryRecord[]> {
    return (
      (await ClusterSummaryModel.find({ riskScore: { $ne: null } })
        .sort({ riskScore: -1, size: -1 })
        .limit(limit)
        .lean()) as unknown as SummaryLean[]
    ).map(toSummary);
  }

  /** Retrieves pairwise link evidence between assets within a cluster. */
  async linksAmong(memberIds: string[], limit: number): Promise<LinkRecord[]> {
    if (!memberIds.length) return [];
    const rows = (await LinkModel.find({
      a: { $in: memberIds },
      b: { $in: memberIds },
    })
      .sort({ score: -1 })
      .limit(limit)
      .lean()) as unknown as Array<{
      a: string;
      b: string;
      score: number;
      evidence: Contribution[];
    }>;
    return rows.map((l) => ({ a: l.a, b: l.b, score: l.score, evidence: l.evidence }));
  }

  /** Computes high-level database dashboard metrics across all collections. */
  async stats(): Promise<Stats> {
    const byType = (await NodeModel.aggregate([
      { $group: { _id: '$type', c: { $sum: 1 } } },
    ])) as Array<{ _id: string; c: number }>;

    const [edges, observations, clusters, correlated] = await Promise.all([
      EdgeModel.estimatedDocumentCount(),
      ObservationModel.estimatedDocumentCount(),
      ClusterSummaryModel.estimatedDocumentCount(),
      ClusterSummaryModel.countDocuments({ riskScore: { $ne: null } }),
    ]);

    return {
      nodes: Object.fromEntries(byType.map((r) => [r._id, r.c])),
      edges,
      observations,
      clusters,
      correlatedClusters: correlated,
    };
  }

  /** Aggregates the most frequently targeted victim brands (e.g. SBI, HDFC, Netflix). */
  async topBrands(limit: number): Promise<Array<{ brand: string; count: number }>> {
    const rows = (await EdgeModel.aggregate([
      { $match: { rel: 'impersonates' } },
      { $group: { _id: '$dst', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: limit },
    ])) as Array<{ _id: string; count: number }>;

    return rows.map((r) => ({
      brand: r._id.slice(r._id.indexOf(':') + 1),
      count: r.count,
    }));
  }
}

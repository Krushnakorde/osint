/**
 * ============================================================================
 * MODULE: Investigation Application Service
 * FILE: backend/src/application/InvestigationService.ts
 * ============================================================================
 *
 * ARCHITECTURAL ROLE:
 * -------------------
 * In Domain-Driven Design (DDD) and Clean Architecture, `InvestigationService` is the
 * core Application Service orchestrating graph queries, risk assessments, and forensic
 * evidence aggregation for end-user investigations.
 *
 * KEY DESIGN PRINCIPLES:
 * ----------------------
 * 1. Zero-Network Query Time (Stealth & Speed):
 *    This service NEVER makes outbound HTTP requests to the internet or target assets.
 *    It queries strictly from the pre-indexed graph store and cluster models. This delivers:
 *    - Instant sub-10ms query latency.
 *    - Zero footprint / operational stealth (the scammer cannot detect active queries).
 *
 * 2. Multi-Vector Asset Expansion:
 *    When a cybersecurity analyst investigates a single indicator (e.g., an IP address,
 *    a domain, or a phone number), the engine automatically pulls in:
 *    - All co-hosted domains on that infrastructure.
 *    - Associated scam campaign clusters (syndicate rings).
 *    - Bipartite links (shared registrar, nameserver, or crypto co-spending wallets).
 *
 * 3. Plain-Language Explainability:
 *    Every verdict is accompanied by deterministic, human-readable rationale
 *    (e.g., "Shares bulletproof nameserver ns1.scamhost.net with 14 known phishing domains").
 * ============================================================================
 */

import { isAsset, normalize } from '../domain/normalize.ts';
import { buildChangeVector } from '../domain/changeVector.ts';
import { verifyEmail } from '../domain/emailVerify.ts';
import { verifyPhone } from '../domain/phoneVerify.ts';
import type { EdgeRecord, NodeRecord } from '../domain/graph.ts';
import type {
  AssetView,
  Assessment,
  ClusterInfo,
  Facts,
  Flag,
  GraphLink,
  GraphNode,
  InvestigationResult,
  LinkEvidence,
  NodeRow,
  NodeType,
  TopCluster,
} from '../domain/types.ts';
import type { AssessmentService } from './AssessmentService.ts';
import type { ClusterStore, GraphReader } from './ports.ts';

/**
 * Priority order for resolving ambiguous raw search queries.
 * If a user types "user@example.com", it matches 'email' before 'domain'.
 * If a user types "1.2.3.4", it matches 'ip'.
 */
const SEARCH_ORDER: NodeType[] = [
  'domain',
  'email',
  'phone',
  'wallet',
  'apk',
  'ip',
  'cert',
  'signer',
  'tracker',
  'package',
  'nameserver',
  'registrar',
  'brand',
  'asn',
];

/** Baseline neutral assessment for an indicator with no observed threat signals. */
const NONE: Assessment = {
  level: 'none',
  score: 0,
  reasons: [{ code: 'no_signals' }],
};

/** Helper to strip the node type prefix: "domain:phish.com" -> "phish.com" */
const tail = (id: string): string => id.slice(id.indexOf(':') + 1);

/**
 * Core Application Service managing investigation workflows.
 */
export class InvestigationService {
  private readonly reader: GraphReader;
  private readonly clusters: ClusterStore;
  private readonly assessment: AssessmentService;

  constructor(
    reader: GraphReader,
    clusters: ClusterStore,
    assessment: AssessmentService
  ) {
    this.reader = reader;
    this.clusters = clusters;
    this.assessment = assessment;
  }

  /**
   * Resolves a raw user search string into a validated NodeRecord in the graph.
   *
   * @param q Raw search query (e.g. "sbi-kyc.top" or "+919876543210").
   * @returns The matching node, or null if not yet present in our knowledge base.
   */
  async findNode(q: string): Promise<NodeRow | null> {
    // Generate candidate node IDs across all valid node types
    const candidates = SEARCH_ORDER.map((t) => `${t}:${normalize(t, q)}`);
    const found = new Map((await this.reader.getNodes(candidates)).map((n) => [n.id, n]));

    for (const id of candidates) {
      const n = found.get(id);
      if (n) return { id: n.id, type: n.type, value: n.value };
    }
    return null;
  }

  /**
   * Retrieves the top scam clusters ranked by composite risk score and size.
   */
  async topClusters(limit: number): Promise<TopCluster[]> {
    return (await this.clusters.topSummaries(limit)).map((s) => ({
      id: s.clusterId,
      size: s.size,
      vectors: s.vectors,
      confidence: s.confidence,
      risk_score: s.riskScore,
    }));
  }

  /**
   * Conducts a complete 360-degree forensic investigation on a target indicator.
   *
   * Five-Phase Execution Pipeline:
   * 1. Query Resolution: Identify the starting node in the database.
   * 2. Seed Asset Expansion: Locate all direct threat assets linked to this entity.
   * 3. Bipartite Graph Traversal: Pull shared infrastructure (nameservers, IPs, certs).
   * 4. Linking Infrastructure Pruning: Retain shared hubs (nodes with >=2 links) to keep
   *    visualization crisp and informative without overwhelming the analyst.
   * 5. Assessment & Evidence Assembly: Calculate heuristic + ML risk scores, extract
   *    change vectors (temporal churn), and verify communication identifiers.
   *
   * @param q Raw search input string.
   * @param maxNodes Maximum graph nodes returned (defaults to 300 to protect browser canvas).
   */
  async investigate(q: string, maxNodes = 300): Promise<InvestigationResult> {
    // ------------------------------------------------------------------------
    // PHASE 1: Query Resolution
    // ------------------------------------------------------------------------
    const start = await this.findNode(q);
    if (!start) {
      // Return suggestions for partial/fuzzy typo matches
      return {
        found: false,
        suggestions: await this.reader.searchNodes(String(q).toLowerCase(), 8),
      };
    }

    // ------------------------------------------------------------------------
    // PHASE 2: Seed Asset Expansion
    // ------------------------------------------------------------------------
    let seedAssets: string[];
    if (isAsset(start.type)) {
      // If query is an asset (e.g. domain, phone, email, wallet), it is its own seed
      seedAssets = [start.id];
    } else {
      // If query is infrastructure (e.g. an IP address or nameserver), find all assets that touch it
      seedAssets = [
        ...new Set(
          (await this.reader.edgesTouching([start.id])).flatMap((e) => [e.src, e.dst])
        ),
      ].filter((id) => id !== start.id && isAsset(id.split(':')[0]));
    }

    // Identify which scam syndicate clusters these assets belong to
    const clusterOf = await this.clusters.clusterIdsOf(seedAssets);
    const clusterIds = [...new Set(clusterOf.values())];

    // Expand to all sister assets in the same clusters
    const assetIds = (
      await Promise.all(clusterIds.map((c) => this.clusters.members(c)))
    ).flat();
    const assetSet = new Set(assetIds);

    // ------------------------------------------------------------------------
    // PHASE 3 & 4: Shared Infrastructure Graph Assembly & Pruning
    // ------------------------------------------------------------------------
    const edges = await this.reader.edgesTouching(assetIds);
    const attrCount = new Map<string, number>();
    const seen = new Set<string>();
    const edgeRows: GraphLink[] = [];

    for (const e of edges) {
      const key = `${e.src}|${e.dst}|${e.rel}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edgeRows.push({ source: e.src, target: e.dst, rel: e.rel, weight: e.weight });

      // Track how many cluster assets share this infrastructure attribute
      for (const end of [e.src, e.dst]) {
        if (!assetSet.has(end)) {
          attrCount.set(end, (attrCount.get(end) ?? 0) + 1);
        }
      }
    }

    // Linking infrastructure heuristic:
    // Only include infrastructure nodes that bridge >= 2 distinct assets in the cluster,
    // or all attributes if the asset is solitary. This filters out irrelevant clutter.
    const keepAttr = new Set(
      [...attrCount]
        .filter(([, count]) => count >= 2 || assetIds.length === 1)
        .map(([id]) => id)
    );
    keepAttr.add(start.id); // Always include the queried node itself

    const nodeIds = [...new Set([...assetIds, ...keepAttr])].slice(0, maxNodes);
    const keep = new Set(nodeIds);

    // Fetch full metadata for all surviving nodes
    const records = new Map((await this.reader.getNodes(nodeIds)).map((n) => [n.id, n]));
    const clusterIdOfNode = await this.clusters.clusterIdsOf(nodeIds);

    const nodes: GraphNode[] = nodeIds.flatMap((id) => {
      const r = records.get(id);
      if (!r) return [];
      return [
        {
          id: r.id,
          type: r.type,
          value: r.value,
          meta: r.meta,
          cluster: clusterIdOfNode.get(id) ?? null,
          isQuery: id === start.id,
        },
      ];
    });

    // Keep only edges where both source and target exist in the visible node set
    const links = edgeRows.filter((e) => keep.has(e.source) && keep.has(e.target));

    // ------------------------------------------------------------------------
    // PHASE 5: Verdicts, Evidence, & Threat Intelligence Assembly
    // ------------------------------------------------------------------------
    const clusters: ClusterInfo[] = (await this.clusters.summaries(clusterIds)).map((s) => ({
      id: s.clusterId,
      size: s.size,
      vectors: s.vectors,
      confidence: s.confidence,
      risk_score: s.riskScore,
    }));

    // Bipartite link evidence between syndicate assets (capped at 50 pairs for UI speed)
    const evidence: LinkEvidence[] =
      assetIds.length < 400
        ? (await this.clusters.linksAmong(assetIds, 50)).map((l) => ({
            a: l.a,
            b: l.b,
            score: l.score,
            evidence: l.evidence,
          }))
        : [];

    // Extract blocklist and report tags (e.g. URLhaus, PhishTank, OpenPhish)
    const flags: Flag[] = edgeRows
      .filter((e) => e.target.startsWith('blocklist:') || e.target.startsWith('report:'))
      .map((e): Flag => ({
        asset: e.source,
        type: e.target.startsWith('blocklist:') ? 'blocklist' : 'report',
        value: tail(e.target),
      }))
      .slice(0, 60);

    // Compute composite risk assessments across member assets
    const capped = assetIds.slice(0, 300);
    const assessments = await this.assessment.assessGroup(capped);

    const assets: AssetView[] = capped
      .flatMap((id) => {
        const r = records.get(id) ?? (undefined as NodeRecord | undefined);
        if (!r) return [];
        return [{ id: r.id, type: r.type, value: r.value, assessment: assessments.get(id) ?? NONE }];
      })
      .sort((a, b) => (b.assessment.score ?? 0) - (a.assessment.score ?? 0));

    const flaggedCount = assets.filter((a) => (a.assessment.score ?? 0) >= 30).length;

    // Determine verdict for the queried indicator
    const assessment: Assessment = isAsset(start.type)
      ? assessments.get(start.id) ?? NONE
      : {
          level: 'info',
          score: null,
          reasons: [
            {
              code: 'infra_summary',
              params: { n: assets.length, flagged: flaggedCount },
            },
          ],
        };

    // Build temporal change vector (tracks infrastructure churn and vector shifts)
    const changeVector = buildChangeVector(start, clusters, edgeRows, records);

    // Verify communication identifiers (e.g., disposable email check, TRAI DLT validation)
    const emailFacts = start.type === 'email' ? verifyEmail(start.value).facts : null;
    const phoneFacts = start.type === 'phone' ? verifyPhone(start.value).facts : null;

    return {
      found: true,
      query: start,
      clusters,
      graph: { nodes, links },
      evidence,
      flags,
      truncated: nodeIds.length >= maxNodes,
      assessment,
      assets,
      facts: start.type === 'domain' ? factsFor(start.id, edges, records.get(start.id)) : null,
      changeVector,
      emailFacts,
      phoneFacts,
    };
  }
}

/**
 * Extracts key domain registration and security facts for quick card display.
 *
 * @param id The node identifier (e.g. "domain:fraud-example.com").
 * @param edges All graph edges touching this domain.
 * @param rec The raw node record containing metadata.
 * @returns Clean Facts object summarizing registration, registrar, nameservers, IPs, and flags.
 */
function factsFor(id: string, edges: EdgeRecord[], rec: NodeRecord | undefined): Facts {
  const pick = (rel: string): string[] =>
    edges.filter((e) => e.src === id && e.rel === rel).map((e) => tail(e.dst));

  return {
    registered: typeof rec?.meta.registered === 'string' ? rec.meta.registered : undefined,
    registrar: pick('registered_via')[0],
    nameservers: pick('uses_ns'),
    ips: pick('resolves_to'),
    blocklists: pick('listed_in'),
    reports: pick('mentioned_in'),
    brand: pick('impersonates')[0],
    certificates: pick('uses_cert').length,
  };
}

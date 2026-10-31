import { isAsset, normalize } from '../domain/normalize.ts';
import { buildChangeVector } from '../domain/changeVector.ts';
import { verifyEmail } from '../domain/emailVerify.ts';
import { verifyPhone } from '../domain/phoneVerify.ts';
import type { EdgeRecord, NodeRecord } from '../domain/graph.ts';
import type {
  AssetView, Assessment, ClusterInfo, Facts, Flag, GraphLink, GraphNode, InvestigationResult, LinkEvidence, NodeRow, NodeType, TopCluster,
} from '../domain/types.ts';
import type { AssessmentService } from './AssessmentService.ts';
import type { ClusterStore, GraphReader } from './ports.ts';

const SEARCH_ORDER: NodeType[] = ['domain', 'email', 'phone', 'wallet', 'apk', 'ip', 'cert', 'signer', 'tracker', 'package', 'nameserver', 'registrar', 'brand', 'asn'];
const NONE: Assessment = { level: 'none', score: 0, reasons: [{ code: 'no_signals' }] };
const tail = (id: string): string => id.slice(id.indexOf(':') + 1);

/** Single responsibility: answer "what is known about this indicator?" from stored data (no network). */
export class InvestigationService {
  private readonly reader: GraphReader;
  private readonly clusters: ClusterStore;
  private readonly assessment: AssessmentService;
  constructor(reader: GraphReader, clusters: ClusterStore, assessment: AssessmentService) { this.reader = reader; this.clusters = clusters; this.assessment = assessment; }

  async findNode(q: string): Promise<NodeRow | null> {
    const candidates = SEARCH_ORDER.map((t) => `${t}:${normalize(t, q)}`);
    const found = new Map((await this.reader.getNodes(candidates)).map((n) => [n.id, n]));
    for (const id of candidates) { const n = found.get(id); if (n) return { id: n.id, type: n.type, value: n.value }; }
    return null;
  }

  async topClusters(limit: number): Promise<TopCluster[]> {
    return (await this.clusters.topSummaries(limit)).map((s) => ({ id: s.clusterId, size: s.size, vectors: s.vectors, confidence: s.confidence, risk_score: s.riskScore }));
  }

  async investigate(q: string, maxNodes = 300): Promise<InvestigationResult> {
    const start = await this.findNode(q);
    if (!start) return { found: false, suggestions: await this.reader.searchNodes(String(q).toLowerCase(), 8) };

    // 1) which assets are we talking about?
    let seedAssets: string[];
    if (isAsset(start.type)) seedAssets = [start.id];
    else seedAssets = [...new Set((await this.reader.edgesTouching([start.id])).flatMap((e) => [e.src, e.dst]))].filter((id) => id !== start.id && isAsset(id.split(':')[0]));
    const clusterOf = await this.clusters.clusterIdsOf(seedAssets);
    const clusterIds = [...new Set(clusterOf.values())];
    const assetIds = (await Promise.all(clusterIds.map((c) => this.clusters.members(c)))).flat();
    const assetSet = new Set(assetIds);

    // 2) everything that touches them
    const edges = await this.reader.edgesTouching(assetIds);
    const attrCount = new Map<string, number>();
    const seen = new Set<string>(); const edgeRows: GraphLink[] = [];
    for (const e of edges) {
      const key = `${e.src}|${e.dst}|${e.rel}`; if (seen.has(key)) continue; seen.add(key);
      edgeRows.push({ source: e.src, target: e.dst, rel: e.rel, weight: e.weight });
      for (const end of [e.src, e.dst]) if (!assetSet.has(end)) attrCount.set(end, (attrCount.get(end) ?? 0) + 1);
    }
    // linking infrastructure = attribute nodes touching >= 2 cluster assets; a lone asset shows all its attributes
    const keepAttr = new Set([...attrCount].filter(([, c]) => c >= 2 || assetIds.length === 1).map(([id]) => id));
    keepAttr.add(start.id);
    const nodeIds = [...new Set([...assetIds, ...keepAttr])].slice(0, maxNodes);
    const keep = new Set(nodeIds);

    const records = new Map((await this.reader.getNodes(nodeIds)).map((n) => [n.id, n]));
    const clusterIdOfNode = await this.clusters.clusterIdsOf(nodeIds);
    const nodes: GraphNode[] = nodeIds.flatMap((id) => {
      const r = records.get(id); if (!r) return [];
      return [{ id: r.id, type: r.type, value: r.value, meta: r.meta, cluster: clusterIdOfNode.get(id) ?? null, isQuery: id === start.id }];
    });
    const links = edgeRows.filter((e) => keep.has(e.source) && keep.has(e.target));

    // 3) summaries, evidence, verdicts
    const clusters: ClusterInfo[] = (await this.clusters.summaries(clusterIds)).map((s) => ({ id: s.clusterId, size: s.size, vectors: s.vectors, confidence: s.confidence, risk_score: s.riskScore }));
    const evidence: LinkEvidence[] = assetIds.length < 400
      ? (await this.clusters.linksAmong(assetIds, 50)).map((l) => ({ a: l.a, b: l.b, score: l.score, evidence: l.evidence }))
      : [];
    const flags: Flag[] = edgeRows.filter((e) => e.target.startsWith('blocklist:') || e.target.startsWith('report:'))
      .map((e): Flag => ({ asset: e.source, type: e.target.startsWith('blocklist:') ? 'blocklist' : 'report', value: tail(e.target) })).slice(0, 60);

    const capped = assetIds.slice(0, 300);
    const assessments = await this.assessment.assessGroup(capped);
    const assets: AssetView[] = capped.flatMap((id) => {
      const r = records.get(id) ?? (undefined as NodeRecord | undefined); if (!r) return [];
      return [{ id: r.id, type: r.type, value: r.value, assessment: assessments.get(id) ?? NONE }];
    }).sort((a, b) => (b.assessment.score ?? 0) - (a.assessment.score ?? 0));
    const flaggedCount = assets.filter((a) => (a.assessment.score ?? 0) >= 30).length;
    const assessment: Assessment = isAsset(start.type)
      ? assessments.get(start.id) ?? NONE
      : { level: 'info', score: null, reasons: [{ code: 'infra_summary', params: { n: assets.length, flagged: flaggedCount } }] };

    const changeVector = buildChangeVector(start, clusters, edgeRows, records);
    const emailFacts = start.type === 'email' ? verifyEmail(start.value).facts : null;
    const phoneFacts = start.type === 'phone' ? verifyPhone(start.value).facts : null;

    return {
      found: true, query: start, clusters, graph: { nodes, links }, evidence, flags, truncated: nodeIds.length >= maxNodes,
      assessment, assets, facts: start.type === 'domain' ? factsFor(start.id, edges, records.get(start.id)) : null,
      changeVector, emailFacts, phoneFacts,
    };
  }
}

function factsFor(id: string, edges: EdgeRecord[], rec: NodeRecord | undefined): Facts {
  const pick = (rel: string): string[] => edges.filter((e) => e.src === id && e.rel === rel).map((e) => tail(e.dst));
  return {
    registered: typeof rec?.meta.registered === 'string' ? rec.meta.registered : undefined,
    registrar: pick('registered_via')[0], nameservers: pick('uses_ns'), ips: pick('resolves_to'),
    blocklists: pick('listed_in'), reports: pick('mentioned_in'), brand: pick('impersonates')[0], certificates: pick('uses_cert').length,
  };
}

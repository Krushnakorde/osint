import type { GraphStore } from '../../application/ports.ts';
import type { ClusterSummaryRecord, CorrelationOutput, EdgeDoc, EdgeRecord, GraphBatch, LinkRecord, NodeRecord, Snapshot } from '../../domain/graph.ts';
import type { IngestStats, NodeRow, NodeType, Stats } from '../../domain/types.ts';

type Stored = NodeRecord & { seq: number };

/** In-memory adapter: used by the tests, the evaluation harness and `STORAGE=memory` demo mode. */
export class MemoryGraphStore implements GraphStore {
  private nodes = new Map<string, Stored>();
  private edges = new Map<string, EdgeDoc>();
  private bySrc = new Map<string, EdgeDoc[]>();
  private byDst = new Map<string, EdgeDoc[]>();
  private observations = new Map<string, unknown>();
  private clusterOf = new Map<string, string>();
  private summaryMap = new Map<string, ClusterSummaryRecord>();
  private linkList: LinkRecord[] = [];
  private seq = 0;

  private push(map: Map<string, EdgeDoc[]>, key: string, e: EdgeDoc): void { const l = map.get(key); if (l) l.push(e); else map.set(key, [e]); }
  private rec = (n: Stored): NodeRecord => ({ id: n.id, type: n.type, value: n.value, firstSeen: n.firstSeen, meta: { ...n.meta } });
  private edgeRec = (e: EdgeDoc): EdgeRecord => ({ src: e.src, dst: e.dst, rel: e.rel, weight: e.weight, evidence: e.evidence });

  async applyBatches(batches: GraphBatch[]): Promise<IngestStats[]> {
    return batches.map((b) => {
      const stats: IngestStats = { nodes: 0, edges: 0 };
      for (const n of b.nodes) if (!this.nodes.has(n.id)) { this.nodes.set(n.id, { ...n, meta: {}, seq: this.seq++ }); stats.nodes++; }
      for (const e of b.edges) {
        const key = `${e.src}|${e.dst}|${e.rel}`;
        if (this.edges.has(key)) continue;
        this.edges.set(key, e); stats.edges++;
        this.push(this.bySrc, e.src, e); this.push(this.byDst, e.dst, e);
      }
      for (const m of b.meta) { const n = this.nodes.get(m.id); if (n) Object.assign(n.meta, m.set); }
      if (!this.observations.has(b.observation.id)) this.observations.set(b.observation.id, b.observation);
      return stats;
    });
  }
  async mergeMeta(id: string, patch: Record<string, unknown>): Promise<void> { const n = this.nodes.get(id); if (n) Object.assign(n.meta, patch); }

  async getNode(id: string): Promise<NodeRecord | null> { const n = this.nodes.get(id); return n ? this.rec(n) : null; }
  async getNodes(ids: string[]): Promise<NodeRecord[]> { return ids.flatMap((id) => { const n = this.nodes.get(id); return n ? [this.rec(n)] : []; }); }
  async searchNodes(fragment: string, limit: number): Promise<NodeRow[]> {
    const out: NodeRow[] = [];
    for (const n of this.nodes.values()) { if (n.value.includes(fragment)) out.push({ id: n.id, type: n.type, value: n.value }); if (out.length >= limit) break; }
    return out;
  }
  async edgesTouching(ids: string[]): Promise<EdgeRecord[]> {
    const seen = new Map<string, EdgeDoc>();
    for (const id of ids) for (const e of [...(this.bySrc.get(id) ?? []), ...(this.byDst.get(id) ?? [])]) seen.set(`${e.src}|${e.dst}|${e.rel}`, e);
    return [...seen.values()].map(this.edgeRec);
  }
  async edgesFrom(ids: string[], rels?: readonly string[]): Promise<EdgeRecord[]> {
    return ids.flatMap((id) => (this.bySrc.get(id) ?? []).filter((e) => !rels || rels.includes(e.rel))).map(this.edgeRec);
  }
  async recentNodes(type: NodeType, limit: number): Promise<NodeRecord[]> {
    return [...this.nodes.values()].filter((n) => n.type === type).sort((a, b) => b.seq - a.seq).slice(0, limit).map(this.rec);
  }
  async domainsNeedingEnrichment(blocklist: string, limit: number): Promise<string[]> {
    return (this.byDst.get(`blocklist:${blocklist}`) ?? []).filter((e) => e.rel === 'listed_in')
      .map((e) => this.nodes.get(e.src)).filter((n): n is Stored => !!n && n.meta.enriched_at === undefined)
      .sort((a, b) => b.seq - a.seq).slice(0, limit).map((n) => n.value);
  }
  async domainsOnAnyBlocklist(limit: number): Promise<string[]> {
    const out = new Set<string>();
    for (const e of this.edges.values()) if (e.rel === 'listed_in') { const n = this.nodes.get(e.src); if (n) out.add(n.value); if (out.size >= limit) break; }
    return [...out];
  }

  async snapshot(): Promise<Snapshot> {
    return { types: new Map([...this.nodes].map(([id, n]) => [id, n.type])), edges: [...this.edges.values()].map(this.edgeRec) };
  }
  async replaceAll(out: CorrelationOutput): Promise<void> {
    this.clusterOf = new Map(out.memberships); this.summaryMap = new Map(out.summaries.map((s) => [s.clusterId, s])); this.linkList = out.links;
  }
  async clusterIdsOf(nodeIds: string[]): Promise<Map<string, string>> {
    return new Map(nodeIds.flatMap((id) => { const c = this.clusterOf.get(id); return c ? [[id, c] as [string, string]] : []; }));
  }
  async members(clusterId: string): Promise<string[]> { return [...this.clusterOf].filter(([, c]) => c === clusterId).map(([id]) => id); }
  async summaries(clusterIds: string[]): Promise<ClusterSummaryRecord[]> { return clusterIds.flatMap((c) => { const s = this.summaryMap.get(c); return s ? [s] : []; }); }
  async topSummaries(limit: number): Promise<ClusterSummaryRecord[]> {
    return [...this.summaryMap.values()].filter((s) => s.riskScore !== null).sort((a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0) || b.size - a.size).slice(0, limit);
  }
  async linksAmong(memberIds: string[], limit: number): Promise<LinkRecord[]> {
    const set = new Set(memberIds);
    return this.linkList.filter((l) => set.has(l.a) && set.has(l.b)).sort((x, y) => y.score - x.score).slice(0, limit);
  }

  async stats(): Promise<Stats> {
    const nodes: Record<string, number> = {};
    for (const n of this.nodes.values()) nodes[n.type] = (nodes[n.type] ?? 0) + 1;
    return { nodes, edges: this.edges.size, observations: this.observations.size, clusters: this.summaryMap.size, correlatedClusters: [...this.summaryMap.values()].filter((s) => s.riskScore !== null).length };
  }
  async topBrands(limit: number): Promise<Array<{ brand: string; count: number }>> {
    const m = new Map<string, number>();
    for (const e of this.edges.values()) if (e.rel === 'impersonates') { const b = e.dst.slice(e.dst.indexOf(':') + 1); m.set(b, (m.get(b) ?? 0) + 1); }
    return [...m].map(([brand, count]) => ({ brand, count })).sort((a, b) => b.count - a.count).slice(0, limit);
  }
}

// Plain data shapes that move between the domain, the services and the storage adapters.
import type { Contribution, NodeType, Vector } from './types.ts';

export interface NodeDoc { id: string; type: NodeType; value: string; firstSeen: string }
export interface EdgeDoc { src: string; dst: string; rel: string; weight: number; source: string; evidence: string | null; createdAt: string }
export interface ObservationDoc { id: string; source: string; payload: string; ingestedAt: string }
/** Everything one observation adds to the graph. Pure data: building it needs no database. */
export interface GraphBatch {
  nodes: NodeDoc[]; edges: EdgeDoc[]; observation: ObservationDoc;
  meta: Array<{ id: string; set: Record<string, unknown> }>;
}

export interface NodeRecord { id: string; type: NodeType; value: string; firstSeen: string; meta: Record<string, unknown> }
export interface EdgeRecord { src: string; dst: string; rel: string; weight: number; evidence: string | null }
export interface Snapshot { types: Map<string, NodeType>; edges: EdgeRecord[] }

export interface ClusterSummaryRecord {
  clusterId: string; size: number; vectors: Vector[]; confidence: number | null; riskScore: number | null;
}
export interface LinkRecord { a: string; b: string; score: number; evidence: Contribution[] }
export interface CorrelationOutput {
  memberships: Array<[string, string]>; // [assetId, clusterId]
  summaries: ClusterSummaryRecord[];
  links: LinkRecord[];
}

// Single source of truth: the dashboard re-uses the backend's API types (type-only import, erased at build time).
export type {
  NodeType, Vector, NodeRow, ClusterInfo, LinkEvidence, GraphNode, GraphLink, Investigation, NotFound,
  SourceReport, LiveSummary, Flag, Level, Reason, Assessment, AssetView, RecentItem, Facts, MessageCode,
  Role, PublicUser, ChangeVector, SmishingAnalysis, EmailFacts, PhoneFacts, RelatedScanInfo,
} from '../../backend/src/domain/types.ts';

export type {
  SearchEvent, Totals, TopQuery, DayCount, Slice, TopUser, ModelDoc,
} from '../../backend/src/application/ports.ts';

import type { Metrics, LogisticModel } from '../../backend/src/domain/ml/logistic.ts';
export type { Metrics, LogisticModel };

export type { AnalyticsSummary } from '../../backend/src/application/AnalyticsService.ts';
export type { Insight } from '../../backend/src/domain/analytics.ts';

export interface Stats {
  nodes: Record<string, number>; edges: number; observations: number; clusters: number; correlatedClusters: number;
  live?: { mode: 'live' | 'offline' };
}

export interface ModelResponse {
  model: {
    name: string;
    version: number;
    trainedAt: string;
    trainedOn: { source: string; synthetic: boolean; positives: number; negatives: number };
    metrics: { train: Metrics; test: Metrics };
  } | null;
  features: string[];
}

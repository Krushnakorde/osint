// PORTS: the only things the application layer knows about the outside world.
// Services depend on these interfaces (Dependency Inversion); MongoDB, the in-memory store and the HTTP
// collectors are interchangeable adapters behind them (Liskov: all adapters pass the same contract tests).
// The interfaces are small and role-based (Interface Segregation).
import type { ClusterSummaryRecord, CorrelationOutput, EdgeRecord, GraphBatch, LinkRecord, NodeRecord, Snapshot } from '../domain/graph.ts';
import type { LogisticModel, Metrics } from '../domain/ml/logistic.ts';
import type { IngestStats, Level, NodeRow, NodeType, Role, Stats } from '../domain/types.ts';

/* ---------------------------------------------------------------- graph */
export interface GraphWriter {
  applyBatches(batches: GraphBatch[]): Promise<IngestStats[]>;
  mergeMeta(id: string, patch: Record<string, unknown>): Promise<void>;
}
export interface GraphReader {
  getNode(id: string): Promise<NodeRecord | null>;
  getNodes(ids: string[]): Promise<NodeRecord[]>;
  searchNodes(fragment: string, limit: number): Promise<NodeRow[]>;
  /** Edges where src OR dst is in `ids`. */
  edgesTouching(ids: string[]): Promise<EdgeRecord[]>;
  /** Edges whose src is in `ids`, optionally limited to some relations. */
  edgesFrom(ids: string[], rels?: readonly string[]): Promise<EdgeRecord[]>;
  recentNodes(type: NodeType, limit: number): Promise<NodeRecord[]>;
  /** Domains listed on `blocklist` that have not had a live lookup yet (newest first). */
  domainsNeedingEnrichment(blocklist: string, limit: number): Promise<string[]>;
  /** Domains that carry a blocklist edge (real fraud labels for model training). */
  domainsOnAnyBlocklist(limit: number): Promise<string[]>;
}
export interface SnapshotSource { snapshot(): Promise<Snapshot> }
export interface ClusterStore {
  replaceAll(out: CorrelationOutput): Promise<void>;
  clusterIdsOf(nodeIds: string[]): Promise<Map<string, string>>;
  members(clusterId: string): Promise<string[]>;
  summaries(clusterIds: string[]): Promise<ClusterSummaryRecord[]>;
  topSummaries(limit: number): Promise<ClusterSummaryRecord[]>;
  /** Linked pairs with BOTH ends inside `memberIds`, strongest first. */
  linksAmong(memberIds: string[], limit: number): Promise<LinkRecord[]>;
}
export interface GraphStatsReader {
  stats(): Promise<Stats>;
  /** Most imitated brands (count of look-alike domains per brand). */
  topBrands(limit: number): Promise<Array<{ brand: string; count: number }>>;
}
export type GraphStore = GraphWriter & GraphReader & SnapshotSource & ClusterStore & GraphStatsReader;

/* ---------------------------------------------------------------- users & security */
export interface UserRecord { id: string; email: string; name: string; passwordHash: string; role: Role; createdAt: string; lastLoginAt?: string }
export type NewUser = Omit<UserRecord, 'id' | 'createdAt' | 'lastLoginAt'>;
export interface UserRepository {
  create(u: NewUser): Promise<UserRecord>;
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  findByIds(ids: string[]): Promise<UserRecord[]>;
  count(): Promise<number>;
  touchLogin(id: string): Promise<void>;
}
export interface RevokedTokenRepository {
  revoke(jti: string, expiresAt: Date): Promise<void>;
  isRevoked(jti: string): Promise<boolean>;
}
export interface PasswordHasher { hash(password: string): Promise<string>; verify(password: string, hash: string): Promise<boolean> }
export interface TokenClaims { sub: string; role: Role; jti: string; iat: number; exp: number }
export interface TokenService {
  sign(claims: { sub: string; role: Role }, nowMs?: number): { token: string; claims: TokenClaims };
  verify(token: string, nowMs?: number): TokenClaims | null;
}
export interface AttemptLimiter {
  /** Seconds to wait before another attempt (0 = allowed). */
  retryAfter(key: string, nowMs?: number): number;
  recordFailure(key: string, nowMs?: number): void;
  reset(key: string): void;
}

/* ---------------------------------------------------------------- search history & analytics */
export interface SearchEvent {
  id: string; userId: string; query: string; value: string; kind: string;
  found: boolean; level: Level | null; live: boolean; stored: boolean; latencyMs: number; createdAt: string;
}
export type NewSearchEvent = Omit<SearchEvent, 'id' | 'createdAt'> & { createdAt?: string };
export interface SearchEventRepository {
  add(e: NewSearchEvent): Promise<SearchEvent>;
  listByUser(userId: string, opts: { limit: number; before?: string }): Promise<SearchEvent[]>;
  deleteOne(userId: string, id: string): Promise<boolean>;
  clearUser(userId: string): Promise<number>;
}
/** `userId` undefined = everybody (admin view). */
export interface Scope { userId?: string; since?: Date }
export interface Totals { searches: number; users: number; flagged: number; live: number; avgLatencyMs: number }
export interface TopQuery { value: string; kind: string; count: number }
export interface DayCount { day: string; count: number }
export interface Slice { key: string; count: number }
export interface TopUser { userId: string; count: number }
export interface AnalyticsRepository {
  totals(scope: Scope): Promise<Totals>;
  topQueries(scope: Scope, limit: number): Promise<TopQuery[]>;
  perDay(scope: Scope): Promise<DayCount[]>;
  byLevel(scope: Scope): Promise<Slice[]>;
  byKind(scope: Scope): Promise<Slice[]>;
  /** 7 x 24 matrix, row = weekday (0 = Sunday), column = hour; UTC. */
  heatmap(scope: Scope): Promise<number[][]>;
  topUsers(scope: Scope, limit: number): Promise<TopUser[]>;
}

/* ---------------------------------------------------------------- AI model storage & use */
export interface ModelDoc {
  name: string; version: number; trainedAt: string; model: LogisticModel;
  trainedOn: { source: string; synthetic: boolean; positives: number; negatives: number };
  metrics: { train: Metrics; test: Metrics };
}
export interface ModelRepository { save(doc: Omit<ModelDoc, 'version'>): Promise<ModelDoc>; latest(name: string): Promise<ModelDoc | null> }
export interface DomainClassifier {
  /** Probability (0..1) that the domain is fraudulent, or null when no model is loaded. */
  predict(domain: string): number | null;
  info(): Omit<ModelDoc, 'model'> | null;
}
export interface LabelledSet { domains: string[]; labels: number[]; source: string; synthetic: boolean }
export interface TrainingDataProvider { name: string; load(): Promise<LabelledSet> }

/* ---------------------------------------------------------------- misc */
export interface Clock { now(): number }
export const systemClock: Clock = { now: () => Date.now() };

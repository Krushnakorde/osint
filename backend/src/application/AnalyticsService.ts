import { buildInsights, fillDays, type Insight } from '../domain/analytics.ts';
import { AppError } from '../domain/errors.ts';
import type { PublicUser } from '../domain/types.ts';
import type { AnalyticsRepository, Clock, DayCount, GraphStatsReader, Slice, TopQuery, Totals, UserRepository } from './ports.ts';
import { systemClock } from './ports.ts';

export interface AnalyticsSummary {
  scope: 'me' | 'all'; days: number; generatedAt: string; totals: Totals; topQueries: TopQuery[]; perDay: DayCount[];
  levels: Slice[]; kinds: Slice[]; heatmap: number[][]; topBrands: Array<{ brand: string; count: number }>;
  topUsers?: Array<{ name: string; email: string; count: number }>; insights: Insight[];
}

/** Single responsibility: the numbers behind the BI dashboard. A normal user sees only their own activity; admins can see everyone's. */
export class AnalyticsService {
  private readonly repo: AnalyticsRepository;
  private readonly graph: GraphStatsReader;
  private readonly users: UserRepository;
  private readonly clock: Clock;
  constructor(repo: AnalyticsRepository, graph: GraphStatsReader, users: UserRepository, clock: Clock = systemClock) { this.repo = repo; this.graph = graph; this.users = users; this.clock = clock; }

  async summary(requester: PublicUser, opts: { scope?: string; days?: number } = {}): Promise<AnalyticsSummary> {
    const scopeName = opts.scope === 'all' ? 'all' : 'me';
    if (scopeName === 'all' && requester.role !== 'admin') throw new AppError(403, 'forbidden', 'Only administrators can see everyone’s activity.');
    const days = Math.min(Math.max(Math.trunc(opts.days ?? 30), 1), 365);
    const now = this.clock.now();
    const who = scopeName === 'me' ? { userId: requester.id } : {};
    const scope = { ...who, since: new Date(now - days * 86_400_000) };
    const [totals, topQueries, daily, levels, kinds, heatmap, topBrands, userCounts] = await Promise.all([
      this.repo.totals(scope), this.repo.topQueries(scope, 10), this.repo.perDay({ ...who, since: new Date(now - 2 * days * 86_400_000) }),
      this.repo.byLevel(scope), this.repo.byKind(scope), this.repo.heatmap(scope), this.graph.topBrands(8),
      scopeName === 'all' ? this.repo.topUsers(scope, 8) : Promise.resolve([]),
    ]);
    const filled = fillDays(daily, days * 2, now);
    const current = filled.slice(days); const previous = filled.slice(0, days);
    const people = userCounts.length ? new Map((await this.users.findByIds(userCounts.map((u) => u.userId))).map((u) => [u.id, u])) : new Map();
    return {
      scope: scopeName, days, generatedAt: new Date(now).toISOString(), totals, topQueries, perDay: current, levels, kinds, heatmap, topBrands,
      ...(scopeName === 'all' ? { topUsers: userCounts.map((u) => ({ name: people.get(u.userId)?.name ?? '?', email: people.get(u.userId)?.email ?? '', count: u.count })) } : {}),
      insights: buildInsights({ current, previous, totals, topQueries, heatmap }),
    };
  }
}

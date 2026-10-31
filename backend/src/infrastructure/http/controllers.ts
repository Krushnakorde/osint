// One small controller per concern (Single Responsibility). Controllers translate HTTP <-> services and hold no business logic.
import type { AnalyticsService } from '../../application/AnalyticsService.ts';
import type { AssessmentService } from '../../application/AssessmentService.ts';
import type { AuthService } from '../../application/AuthService.ts';
import type { CorrelationService } from '../../application/CorrelationService.ts';
import type { FeedService } from '../../application/FeedService.ts';
import type { IngestService } from '../../application/IngestService.ts';
import type { ModelService } from '../../application/ModelService.ts';
import type { GraphStatsReader } from '../../application/ports.ts';
import type { SearchHistoryService } from '../../application/SearchHistoryService.ts';
import type { SearchService } from '../../application/SearchService.ts';
import { AppError } from '../../domain/errors.ts';
import { FEATURE_NAMES } from '../../domain/ml/features.ts';
import { analyzeMessage } from '../../domain/smishing.ts';
import type { Observation } from '../../domain/types.ts';
import { requireAdmin, requireAuth } from './middleware.ts';
import type { Ctx, HttpResult, Router } from './Router.ts';

const user = (ctx: Ctx) => { if (!ctx.auth) throw new AppError(401, 'unauthenticated', 'Please log in.'); return ctx.auth; };
const num = (v: string | null, d: number): number => { const n = Number(v); return v === null || Number.isNaN(n) ? d : n; };
const asObject = (b: unknown): Record<string, unknown> => (b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {});

export class AuthController {
  private readonly auth: AuthService;
  constructor(auth: AuthService) { this.auth = auth; }
  register(router: Router): void {
    router.add('POST', '/api/auth/register', async (c): Promise<HttpResult> => ({ status: 201, body: await this.auth.register(asObject(c.body)) }));
    router.add('POST', '/api/auth/login', async (c): Promise<HttpResult> => ({ status: 200, body: await this.auth.login(asObject(c.body), c.ip) }));
    router.add('POST', '/api/auth/logout', async (c): Promise<HttpResult> => { await this.auth.logout(user(c).claims); return { status: 204 }; }, requireAuth(this.auth));
    router.add('GET', '/api/auth/me', async (c): Promise<HttpResult> => ({ status: 200, body: { user: user(c).user } }), requireAuth(this.auth));
  }
}

export class SearchController {
  private readonly search: SearchService;
  private readonly assessment: AssessmentService;
  private readonly auth: AuthService;
  constructor(search: SearchService, assessment: AssessmentService, auth: AuthService) { this.search = search; this.assessment = assessment; this.auth = auth; }
  register(router: Router): void {
    const guard = requireAuth(this.auth);
    router.add('GET', '/api/search', async (c): Promise<HttpResult> => {
      const q = (c.query.get('q') ?? '').trim();
      if (!q || q.length > 2000) throw new AppError(400, 'bad_query', 'Enter something to check (up to 2000 characters).');
      return this.search.search(user(c).user, q, { refresh: c.query.get('refresh') === '1', live: c.query.get('live') !== '0' });
    }, guard);
    router.add('GET', '/api/recent', async (c): Promise<HttpResult> => ({ status: 200, body: await this.assessment.recentFlagged(num(c.query.get('limit'), 12)) }), guard);
    router.add('POST', '/api/message/analyze', async (c): Promise<HttpResult> => {
      const b = asObject(c.body);
      const text = typeof b.text === 'string' ? b.text : '';
      const sender = typeof b.sender === 'string' ? b.sender : undefined;
      if (!text.trim()) throw new AppError(400, 'bad_message', 'Provide message text to analyze.');
      return { status: 200, body: analyzeMessage(text, sender) };
    }, guard);
  }
}

export class HistoryController {
  private readonly history: SearchHistoryService;
  private readonly auth: AuthService;
  constructor(history: SearchHistoryService, auth: AuthService) { this.history = history; this.auth = auth; }
  register(router: Router): void {
    const guard = requireAuth(this.auth);
    router.add('GET', '/api/history', async (c): Promise<HttpResult> => ({ status: 200, body: await this.history.list(user(c).user.id, num(c.query.get('limit'), 50), c.query.get('before') ?? undefined) }), guard);
    router.add('DELETE', '/api/history/:id', async (c): Promise<HttpResult> => { await this.history.remove(user(c).user.id, c.params.id as string); return { status: 204 }; }, guard);
    router.add('DELETE', '/api/history', async (c): Promise<HttpResult> => ({ status: 200, body: { deleted: await this.history.clear(user(c).user.id) } }), guard);
  }
}

export class AnalyticsController {
  private readonly analytics: AnalyticsService;
  private readonly auth: AuthService;
  constructor(analytics: AnalyticsService, auth: AuthService) { this.analytics = analytics; this.auth = auth; }
  register(router: Router): void {
    router.add('GET', '/api/analytics', async (c): Promise<HttpResult> => ({
      status: 200, body: await this.analytics.summary(user(c).user, { scope: c.query.get('scope') ?? 'me', days: num(c.query.get('days'), 30) }),
    }), requireAuth(this.auth));
  }
}

export class ModelController {
  private readonly models: ModelService;
  private readonly auth: AuthService;
  constructor(models: ModelService, auth: AuthService) { this.models = models; this.auth = auth; }
  register(router: Router): void {
    router.add('GET', '/api/model', async (): Promise<HttpResult> => ({ status: 200, body: { model: this.models.info(), features: FEATURE_NAMES } }), requireAuth(this.auth));
    router.add('POST', '/api/model/train', async (c): Promise<HttpResult> => {
      const provider = typeof asObject(c.body).provider === 'string' ? (asObject(c.body).provider as string) : 'graph';
      return { status: 200, body: { model: await this.models.train(provider) } };
    }, requireAuth(this.auth), requireAdmin);
  }
}

export class AdminController {
  private readonly ingest: IngestService;
  private readonly correlation: CorrelationService;
  private readonly feeds: FeedService;
  private readonly graph: GraphStatsReader;
  private readonly auth: AuthService;
  constructor(ingest: IngestService, correlation: CorrelationService, feeds: FeedService, graph: GraphStatsReader, auth: AuthService) {
    this.ingest = ingest; this.correlation = correlation; this.feeds = feeds; this.graph = graph; this.auth = auth;
  }
  register(router: Router): void {
    const guard = requireAuth(this.auth);
    router.add('GET', '/api/stats', async (): Promise<HttpResult> => ({ status: 200, body: await this.graph.stats() }), guard);
    router.add('POST', '/api/observations', async (c): Promise<HttpResult> => {
      const list = Array.isArray(c.body) ? c.body : [c.body];
      if (list.length === 0 || list.length > 500 || list.some((o) => !o || typeof o !== 'object' || Array.isArray(o))) throw new AppError(400, 'bad_observations', 'Send one observation object or an array of up to 500.');
      const results = await this.ingest.ingestMany((list as Observation[]).map((o) => ({ source: 'api', ...o })));
      return { status: 200, body: { ingested: list.length, results, correlation: await this.correlation.run() } };
    }, guard, requireAdmin);
    router.add('POST', '/api/feeds/refresh', async (): Promise<HttpResult> => ({ status: 200, body: await this.feeds.refresh() }), guard, requireAdmin);
    router.add('POST', '/api/correlate', async (): Promise<HttpResult> => ({ status: 200, body: await this.correlation.run() }), guard, requireAdmin);
  }
}

// COMPOSITION ROOT: the only place that knows which concrete classes are used. Everything else receives
// its dependencies through constructors (Dependency Inversion), so any adapter can be swapped without touching a service.
import crypto from 'node:crypto';
import { AnalyticsService } from './application/AnalyticsService.ts';
import { AssessmentService } from './application/AssessmentService.ts';
import { AuthService } from './application/AuthService.ts';
import type { Collector } from './application/collectors.ts';
import { CorrelationService } from './application/CorrelationService.ts';
import { FeedService, type FeedSource } from './application/FeedService.ts';
import { IngestService } from './application/IngestService.ts';
import { InvestigationService } from './application/InvestigationService.ts';
import { LiveLookupService } from './application/LiveLookupService.ts';
import { GraphLabelProvider, ModelService, SyntheticProvider } from './application/ModelService.ts';
import type {
  AnalyticsRepository, AttemptLimiter, Clock, GraphStore, ModelRepository, PasswordHasher, RefreshTokenRepository, RevokedTokenRepository,
  SearchEventRepository, TokenService, UserRepository,
} from './application/ports.ts';
import { SearchHistoryService } from './application/SearchHistoryService.ts';
import { SearchService } from './application/SearchService.ts';
import { config, type Config } from './config.ts';
import type { Brand } from './domain/types.ts';
import { openPhishSource } from './infrastructure/collectors/feedSources.ts';
import { DEFAULT_COLLECTORS } from './infrastructure/collectors/index.ts';
import { loadBenignDomains, loadBrands } from './infrastructure/files.ts';
import { MemoryGraphStore } from './infrastructure/memory/MemoryGraphStore.ts';
import { MemoryModelRepository, MemoryRefreshTokenRepository, MemoryRevokedTokenRepository, MemorySearchStore, MemoryUserRepository } from './infrastructure/memory/MemoryRepositories.ts';
import { Hs256TokenService, ScryptPasswordHasher, WindowAttemptLimiter } from './infrastructure/security/crypto.ts';

export interface Adapters {
  graph: GraphStore; users: UserRepository; revoked: RevokedTokenRepository; refreshTokens: RefreshTokenRepository;
  searches: SearchEventRepository & AnalyticsRepository; models: ModelRepository;
}
export interface WireOptions {
  collectors?: Collector[]; feedSources?: FeedSource[]; hasher?: PasswordHasher; tokens?: TokenService; limiter?: AttemptLimiter;
  brands?: Brand[]; benign?: string[]; clock?: Clock;
}

export function wire(a: Adapters, cfg: Config, o: WireOptions = {}) {
  const brands = o.brands ?? loadBrands();
  const benign = o.benign ?? loadBenignDomains();
  const models = new ModelService(a.models, brands, { synthetic: new SyntheticProvider(brands, benign), graph: new GraphLabelProvider(a.graph, brands, benign) }, o.clock);
  const ingest = new IngestService(a.graph, brands, o.clock);
  const correlation = new CorrelationService(a.graph, a.graph, { threshold: cfg.linkThreshold, maxHub: cfg.maxHubSize });
  const assessment = new AssessmentService(a.graph, brands, models, o.clock);
  const investigation = new InvestigationService(a.graph, a.graph, assessment);
  const live = new LiveLookupService(ingest, a.graph, a.graph, o.collectors ?? DEFAULT_COLLECTORS, cfg, brands, o.clock);
  const history = new SearchHistoryService(a.searches);
  const search = new SearchService(investigation, live, correlation, history, cfg);
  const feeds = new FeedService(o.feedSources ?? [openPhishSource], ingest, a.graph, live, correlation, cfg);
  const secret = cfg.jwtSecret || crypto.randomBytes(32).toString('hex'); // memory/demo mode only (see createAdapters)
  const tokens = o.tokens ?? new Hs256TokenService(secret, cfg.jwtTtlHours);
  const limiter = o.limiter ?? new WindowAttemptLimiter(cfg.loginMaxAttempts, cfg.loginWindowMinutes * 60_000);
  const auth = new AuthService(a.users, o.hasher ?? new ScryptPasswordHasher(), tokens, a.revoked, a.refreshTokens, limiter, cfg, o.clock);
  const analytics = new AnalyticsService(a.searches, a.graph, a.users, o.clock);
  return { brands, models, ingest, correlation, assessment, investigation, live, history, search, feeds, auth, analytics, graph: a.graph };
}
export type Services = ReturnType<typeof wire>;

export function memoryAdapters(): Adapters {
  return {
    graph: new MemoryGraphStore(),
    users: new MemoryUserRepository(),
    revoked: new MemoryRevokedTokenRepository(),
    refreshTokens: new MemoryRefreshTokenRepository(),
    searches: new MemorySearchStore(),
    models: new MemoryModelRepository(),
  };
}

/** Pick the storage backend from configuration. MongoDB code is loaded lazily, so memory mode never needs the driver. */
export async function createAdapters(cfg: Config = config): Promise<{ adapters: Adapters; close: () => Promise<void> }> {
  if (cfg.storage === 'memory') return { adapters: memoryAdapters(), close: async () => undefined };
  if (cfg.jwtSecret.length < 16) throw new Error('Set JWT_SECRET (at least 16 random characters) in backend/.env before using MongoDB mode.');
  const modulePath = './infrastructure/mongo/index.ts'; // variable path: the driver is only loaded in Mongo mode
  const mod = (await import(modulePath)) as { connectMongo: (url: string) => Promise<{ adapters: Adapters; close: () => Promise<void> }> };
  return mod.connectMongo(cfg.mongoUrl);
}

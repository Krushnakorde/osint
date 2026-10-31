import type { Services } from '../../container.ts';
import { config as defaultConfig, type Config } from '../../config.ts';
import { AdminController, AnalyticsController, AuthController, HistoryController, ModelController, SearchController } from './controllers.ts';
import { Router } from './Router.ts';

/** Registers every endpoint. Used by the server and by the end-to-end tests (so they exercise the real routing). */
export function buildRouter(s: Services, cfg: Config = defaultConfig): Router {
  const router = new Router();
  router.add('GET', '/api/health', async () => ({ status: 200, body: { ok: true, storage: cfg.storage, mode: cfg.mode } }));
  new AuthController(s.auth).register(router);
  new SearchController(s.search, s.assessment, s.auth).register(router);
  new HistoryController(s.history, s.auth).register(router);
  new AnalyticsController(s.analytics, s.auth).register(router);
  new ModelController(s.models, s.auth).register(router);
  new AdminController(s.ingest, s.correlation, s.feeds, s.graph, s.auth).register(router);
  return router;
}

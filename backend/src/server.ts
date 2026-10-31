import path from 'node:path';
import { config, root } from './config.ts';
import { createAdapters, wire } from './container.ts';
import { generateDataset } from './domain/synthetic.ts';
import { startBackground } from './infrastructure/background/scheduler.ts';
import { createHttpServer } from './infrastructure/http/HttpServer.ts';
import { buildRouter } from './infrastructure/http/routes.ts';

const { adapters, close } = await createAdapters(config);
const s = wire(adapters, config);

if (config.storage === 'memory') { // demo mode: nothing is persisted, so fill it with the synthetic demo dataset
  await s.ingest.ingestMany(generateDataset({ campaigns: 12, noise: 30, seed: 7 }).observations);
  await s.correlation.run();
  console.log('[memory mode] demo data loaded; everything is lost when the server stops. Set STORAGE=mongo for real use.');
}
await s.models.ensureModel(config.trainDemoModel);
const model = s.models.info();
if (model) console.log(`[ai] model v${model.version} (${model.trainedOn.synthetic ? 'DEMO, synthetic data' : 'real data'}), test AUC ${model.metrics.test.auc}`);

const router = buildRouter(s, config);

const server = createHttpServer(router, { corsOrigin: config.corsOrigin, staticDir: path.resolve(root, '..', 'frontend', 'dist') });
server.listen(config.port, () => console.log(`OSINT backend on http://localhost:${config.port}  (storage: ${config.storage}, live lookups: ${config.mode})`));
startBackground({ cfg: config, feeds: s.feeds, ingest: s.ingest, correlation: s.correlation, brands: s.brands });

const shutdown = (): void => { server.close(); void close().finally(() => process.exit(0)); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);

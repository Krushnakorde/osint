import { config, type Config } from '../src/config.ts';
import type { Collector } from '../src/application/collectors.ts';
import { memoryAdapters, wire, type Adapters, type Services } from '../src/container.ts';
import type { Observation } from '../src/domain/types.ts';
import { loadBenignDomains, loadBrands } from '../src/infrastructure/files.ts';
import { ScryptPasswordHasher } from '../src/infrastructure/security/crypto.ts';
import { setDefaultIntervalMs } from '../src/infrastructure/net-guard.ts';

setDefaultIntervalMs(0); // no politeness delay inside tests (nothing real is contacted)

export const brands = loadBrands();
export const testConfig = (over: Partial<Config> = {}): Config => ({ ...config, mode: 'offline', storage: 'memory', jwtSecret: 'test-secret-test-secret-123456', vtKey: '', urlscanKey: '', ...over });

export interface World { s: Services; a: Adapters; cfg: Config }
/** A complete application on in-memory storage, optionally pre-loaded with observations and correlated. */
export async function world(obs: Observation[] = [], o: { cfg?: Partial<Config>; collectors?: Collector[] } = {}): Promise<World> {
  const cfg = testConfig(o.cfg);
  const a = memoryAdapters();
  const s = wire(a, cfg, { brands, benign: loadBenignDomains(), hasher: new ScryptPasswordHasher(1024), collectors: o.collectors, feedSources: [] });
  if (obs.length) await s.ingest.ingestMany(obs);
  await s.correlation.run();
  return { s, a, cfg };
}
export const daysAgo = (n: number): string => new Date(Date.now() - n * 86_400_000).toISOString();

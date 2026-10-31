import { correlate, type CorrelateOptions } from '../domain/correlate.ts';
import type { ClusterStore, SnapshotSource } from './ports.ts';

export interface CorrelationDefaults { threshold: number; maxHub: number }
export interface CorrelationReport { clusters: number; links: number; assets: number }

/** Single responsibility: read the graph, run the (pure) correlation, store the clusters. */
export class CorrelationService {
  private readonly source: SnapshotSource;
  private readonly store: ClusterStore;
  private readonly defaults: CorrelationDefaults;
  constructor(source: SnapshotSource, store: ClusterStore, defaults: CorrelationDefaults) { this.source = source; this.store = store; this.defaults = defaults; }

  async run(opts: CorrelateOptions = {}): Promise<CorrelationReport> {
    const out = correlate(await this.source.snapshot(), { threshold: this.defaults.threshold, maxHub: this.defaults.maxHub, ...opts });
    await this.store.replaceAll(out);
    return { clusters: out.summaries.length, links: out.links.length, assets: out.memberships.length };
  }
}

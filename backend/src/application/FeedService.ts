import type { Config } from '../config.ts';
import { detectIndicator } from '../domain/detect.ts';
import type { Observation } from '../domain/types.ts';
import type { CorrelationService } from './CorrelationService.ts';
import type { IngestService } from './IngestService.ts';
import type { LiveLookupService } from './LiveLookupService.ts';
import type { GraphReader } from './ports.ts';

/** PORT: a public list of reported scam domains (OpenPhish today; add more by adding an object). */
export interface FeedSource { name: string; load(): Promise<string[]> }

/** Pulls reported domains from public feeds into the store, then enriches a few of them with live lookups. */
export class FeedService {
  private readonly sources: FeedSource[];
  private readonly ingest: IngestService;
  private readonly reader: GraphReader;
  private readonly live: LiveLookupService;
  private readonly correlation: CorrelationService;
  private readonly cfg: Pick<Config, 'feedMaxDomains' | 'feedEnrichPerRun'>;
  constructor(sources: FeedSource[], ingest: IngestService, reader: GraphReader, live: LiveLookupService, correlation: CorrelationService, cfg: Pick<Config, 'feedMaxDomains' | 'feedEnrichPerRun'>) {
    this.sources = sources; this.ingest = ingest; this.reader = reader; this.live = live; this.correlation = correlation; this.cfg = cfg;
  }

  async refresh(): Promise<{ ingested: number; enriched: number }> {
    let ingested = 0; let enriched = 0;
    for (const src of this.sources) {
      const hosts = (await src.load()).filter((h) => detectIndicator(h).kind === 'domain').slice(0, this.cfg.feedMaxDomains);
      const obs: Observation[] = hosts.map((domain) => ({ id: `feed-${src.name}-${domain}`, source: `feed:${src.name}`, domain, blocklists: [src.name] }));
      if (obs.length) await this.ingest.ingestMany(obs);
      ingested += obs.length;
      for (const value of await this.reader.domainsNeedingEnrichment(src.name, this.cfg.feedEnrichPerRun)) {
        try { if ((await this.live.lookup(value)).stored) enriched++; } catch { /* a failing source must not stop the feed */ }
      }
    }
    await this.correlation.run();
    return { ingested, enriched };
  }
}

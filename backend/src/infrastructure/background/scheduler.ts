import type { FeedService } from '../../application/FeedService.ts';
import type { CorrelationService } from '../../application/CorrelationService.ts';
import type { IngestService } from '../../application/IngestService.ts';
import type { Config } from '../../config.ts';
import type { Brand } from '../../domain/types.ts';
import { warmLists } from '../collectors/lists.ts';
import { startCertstream } from './certstream.ts';

export interface BackgroundDeps { cfg: Config; feeds: FeedService; ingest: IngestService; correlation: CorrelationService; brands: Brand[] }

/** Background real-time work (live mode only): blocklist warm-up, feed refresh, optional certstream. */
export function startBackground({ cfg, feeds, ingest, correlation, brands }: BackgroundDeps): void {
  if (cfg.mode !== 'live') return;
  void warmLists();
  if (cfg.feedRefreshHours > 0) {
    const tick = (): void => {
      feeds.refresh().then((r) => console.log(`[feeds] ingested ${r.ingested} reported domains, enriched ${r.enriched}`)).catch((e: Error) => console.warn(`[feeds] ${e.message}`));
    };
    setTimeout(tick, 10_000);
    setInterval(tick, cfg.feedRefreshHours * 3600_000);
    console.log(`[feeds] OpenPhish refresh every ${cfg.feedRefreshHours} h`);
  }
  if (cfg.certstream) {
    startCertstream(ingest, cfg, brands, () => { correlation.run().catch((e: Error) => console.warn(`[certstream] ${e.message}`)); });
    console.log(`[certstream] listening on ${cfg.certstreamUrl} for brand look-alike certificates`);
  }
}

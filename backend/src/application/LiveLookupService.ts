import type { Config } from '../config.ts';
import { detectIndicator, type IndicatorKind } from '../domain/detect.ts';
import { mergeObs, obsHasData } from '../domain/mergeObs.ts';
import { nodeId } from '../domain/normalize.ts';
import type { Brand, LiveSummary, Observation, SourceReport } from '../domain/types.ts';
import type { Collector, CollectorOutput } from './collectors.ts';
import type { IngestService } from './IngestService.ts';
import type { Clock, GraphReader, GraphWriter } from './ports.ts';
import { systemClock } from './ports.ts';

export interface LiveResult extends LiveSummary { observations: number }

const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<T>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} timed out after ${ms} ms`)), ms);
    timer.unref?.();
  });
  return Promise.race([p, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
};

function baseObservation(kind: IndicatorKind, value: string): Observation {
  switch (kind) {
    case 'domain': return { domain: value };
    case 'ip': return { ips: [{ ip: value }] };
    case 'btc': case 'eth': return { wallets: [value] };
    case 'email': return { emails: [value] };
    case 'phone': return { phones: [value] };
    default: return {};
  }
}
function primaryNodeId(kind: IndicatorKind, value: string): string | null {
  switch (kind) {
    case 'domain': return nodeId('domain', value);
    case 'ip': return nodeId('ip', value);
    case 'btc': case 'eth': return nodeId('wallet', value);
    case 'email': return nodeId('email', value);
    case 'phone': return nodeId('phone', value);
    default: return null;
  }
}

/**
 * Real-time lookup of ANY indicator against public passive sources. Everything found is stored automatically;
 * nothing is stored when no source knows the indicator. Sources are injected, so new ones need no change here.
 */
export class LiveLookupService {
  private readonly inflight = new Map<string, Promise<LiveResult>>();
  private readonly ingest: IngestService;
  private readonly reader: GraphReader;
  private readonly writer: GraphWriter;
  private readonly collectors: Collector[];
  private readonly cfg: Config;
  private readonly brands: Brand[];
  private readonly clock: Clock;
  constructor(ingest: IngestService, reader: GraphReader, writer: GraphWriter, collectors: Collector[], cfg: Config, brands: Brand[], clock: Clock = systemClock) {
    this.ingest = ingest; this.reader = reader; this.writer = writer; this.collectors = collectors; this.cfg = cfg; this.brands = brands; this.clock = clock;
  }

  async needsEnrichment(id: string): Promise<boolean> {
    const at = (await this.reader.getNode(id))?.meta.enriched_at;
    return typeof at !== 'string' || this.clock.now() - Date.parse(at) > this.cfg.enrichTtlHours * 3600_000;
  }

  lookup(input: string): Promise<LiveResult> {
    const det = detectIndicator(input);
    const key = `${det.kind}:${det.value}`;
    const running = this.inflight.get(key);
    if (running) return running; // two people searching the same thing share one set of requests
    const p = this.run(det.kind, det.value).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async run(kind: IndicatorKind, value: string): Promise<LiveResult> {
    if (kind === 'unknown') return { kind, stored: false, observations: 0, sources: [] };
    if (kind === 'tracker') {
      return { kind, stored: false, observations: 0, sources: [{ source: 'tracking-id', ok: false, found: false, ms: 0, note: 'no free public reverse lookup exists for tracking IDs; only the local database can answer this' }] };
    }
    const active = this.collectors.filter((c) => c.kinds.includes(kind) && (c.enabled?.(this.cfg) ?? true));
    const ctx = { kind, value, cfg: this.cfg, brands: this.brands };
    const results = await Promise.all(active.map(async (c): Promise<{ rep: SourceReport; out: CollectorOutput | null }> => {
      const t0 = Date.now();
      try {
        const out = await withTimeout(c.run(ctx), this.cfg.liveTimeoutMs, c.name);
        const found = !!out.exists || obsHasData(out.obs) || !!out.extra?.length;
        return { rep: { source: c.name, ok: true, found, ms: Date.now() - t0, note: out.note }, out };
      } catch (e) {
        return { rep: { source: c.name, ok: false, found: false, ms: Date.now() - t0, note: (e as Error).message }, out: null };
      }
    }));
    const sources = results.map((r) => r.rep);
    if (!sources.some((s) => s.found)) return { kind, stored: false, observations: 0, sources };

    let merged = baseObservation(kind, value);
    const extras: Observation[] = [];
    for (const { out } of results) { if (!out) continue; if (out.obs) merged = mergeObs(merged, out.obs); if (out.extra) extras.push(...out.extra); }
    const stamp = this.clock.now();
    const list: Observation[] = [];
    if (merged.domain || merged.ips?.length || merged.wallets?.length || merged.apk || merged.emails?.length || merged.phones?.length) list.push({ ...merged, id: `live-${kind}-${value}-${stamp}`, source: 'live' });
    extras.forEach((x, i) => list.push({ ...x, id: x.id ?? `live-${kind}-${value}-${stamp}-x${i}` }));
    await this.ingest.ingestMany(list);
    const pid = primaryNodeId(kind, value);
    if (pid) await this.writer.mergeMeta(pid, { enriched_at: new Date(stamp).toISOString() });
    return { kind, stored: true, observations: list.length, sources };
  }
}

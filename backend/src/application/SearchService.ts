import type { Config } from '../config.ts';
import { detectIndicator } from '../domain/detect.ts';
import { analyzeMessage } from '../domain/smishing.ts';
import type { Investigation, InvestigationResult, LiveSummary, MessageCode, NodeRow, NotFound, PublicUser } from '../domain/types.ts';
import type { CorrelationService } from './CorrelationService.ts';
import type { InvestigationService } from './InvestigationService.ts';
import type { LiveLookupService } from './LiveLookupService.ts';
import type { SearchHistoryService } from './SearchHistoryService.ts';

export interface SearchOptions { refresh?: boolean; live?: boolean }
export type SearchOutcome = { status: 200; body: Investigation } | { status: 404; body: NotFound };

/** Orchestrates one user search: live lookup (if needed) -> correlate -> investigate -> remember in the user's history. */
export class SearchService {
  private readonly investigation: InvestigationService;
  private readonly live: LiveLookupService;
  private readonly correlation: CorrelationService;
  private readonly history: SearchHistoryService;
  private readonly cfg: Pick<Config, 'mode'>;
  constructor(investigation: InvestigationService, live: LiveLookupService, correlation: CorrelationService, history: SearchHistoryService, cfg: Pick<Config, 'mode'>) {
    this.investigation = investigation; this.live = live; this.correlation = correlation; this.history = history; this.cfg = cfg;
  }

  async search(user: PublicUser, query: string, opts: SearchOptions = {}): Promise<SearchOutcome> {
    const t0 = process.hrtime.bigint();
    const det = detectIndicator(query);

    if (det.kind === 'message') {
      const smishing = analyzeMessage(query);
      const primary = smishing.extracted.domains[0] || smishing.extracted.phones[0] || smishing.extracted.emails[0];
      let live: LiveSummary | undefined;
      let out: InvestigationResult = { found: false, suggestions: [] };
      if (primary) {
        const useLive = this.cfg.mode === 'live' && opts.live !== false;
        if (useLive) {
          const r = await this.live.lookup(primary);
          live = { kind: r.kind, stored: r.stored, sources: r.sources };
          if (r.stored) await this.correlation.run();
        }
        out = await this.investigation.investigate(primary);
      }
      const latencyMs = Number(process.hrtime.bigint() - t0) / 1e6;
      const level = smishing.riskScore >= 60 ? 'high' : smishing.riskScore >= 30 ? 'suspicious' : 'none';
      const base = { userId: user.id, query, value: primary || 'message', kind: 'message', live: !!live, stored: !!live?.stored, latencyMs };
      if (out.found) {
        await this.safeRecord({ ...base, found: true, level });
        return { status: 200, body: { ...out, smishing, latencyMs } };
      }
      await this.safeRecord({ ...base, found: false, level });
      const queryNode: NodeRow = { id: `message:${Date.now()}`, type: 'domain', value: primary || 'smishing-message' };
      return {
        status: 200,
        body: {
          found: true,
          query: queryNode,
          clusters: [],
          graph: { nodes: [{ id: queryNode.id, type: queryNode.type, value: queryNode.value, cluster: null, isQuery: true, meta: {} }], links: [] },
          evidence: [],
          flags: [],
          truncated: false,
          latencyMs,
          assessment: {
            level,
            score: smishing.riskScore,
            reasons: smishing.reasons.map((r) => ({ code: 'lookalike' as const, params: { brand: r } })),
          },
          assets: [],
          facts: null,
          smishing,
        },
      };
    }

    const existing = await this.investigation.findNode(query);
    const useLive = this.cfg.mode === 'live' && opts.live !== false && det.kind !== 'unknown';
    let live: LiveSummary | undefined;
    if (useLive && (!existing || opts.refresh || (await this.live.needsEnrichment(existing.id)))) {
      const r = await this.live.lookup(query);
      live = { kind: r.kind, stored: r.stored, sources: r.sources };
      if (r.stored) await this.correlation.run();
    }
    const out: InvestigationResult = await this.investigation.investigate(query);
    const latencyMs = Number(process.hrtime.bigint() - t0) / 1e6;
    const base = { userId: user.id, query, value: det.kind === 'unknown' ? query.trim().toLowerCase() : det.value, kind: det.kind, live: !!live, stored: !!live?.stored, latencyMs };
    if (out.found) {
      await this.safeRecord({ ...base, found: true, level: out.assessment.level });
      return { status: 200, body: { ...out, latencyMs, ...(live ? { live } : {}) } };
    }
    const messageCode: MessageCode = det.kind === 'unknown' ? 'unrecognised' : this.cfg.mode !== 'live' ? 'offline'
      : live && live.sources.length > 0 && live.sources.every((s) => !s.ok) ? 'unreachable' : 'nodata';
    await this.safeRecord({ ...base, found: false, level: null });
    return { status: 404, body: { ...out, live, messageCode } };
  }

  /** History must never break a search. */
  private async safeRecord(e: Parameters<SearchHistoryService['record']>[0]): Promise<void> {
    try { await this.history.record(e); } catch (err) { console.warn(`[history] could not record: ${(err as Error).message}`); }
  }
}

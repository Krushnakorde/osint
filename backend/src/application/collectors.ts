// PORT for live data sources. Adding a source = adding one object to the registry (Open/Closed); nothing else changes.
import type { Config } from '../config.ts';
import type { IndicatorKind } from '../domain/detect.ts';
import type { Brand, Observation } from '../domain/types.ts';

export interface LookupCtx { kind: IndicatorKind; value: string; cfg: Config; brands: Brand[] }
export interface CollectorOutput {
  obs?: Observation;       // facts about the searched indicator itself (merged with other collectors')
  extra?: Observation[];   // other indicators discovered while looking (siblings, co-hosted domains, ...)
  exists?: boolean;        // the source positively knows this indicator (even if it adds no edges)
  note?: string;
}
export interface Collector {
  name: string;
  kinds: IndicatorKind[];
  enabled?: (cfg: Config) => boolean;
  run: (ctx: LookupCtx) => Promise<CollectorOutput>;
}

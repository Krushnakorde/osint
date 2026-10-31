import { buildBatch } from '../domain/buildBatch.ts';
import type { Brand, IngestStats, Observation } from '../domain/types.ts';
import type { Clock, GraphWriter } from './ports.ts';
import { systemClock } from './ports.ts';

/** Single responsibility: turn observations into stored graph data. */
export class IngestService {
  private seq = 0;
  private readonly writer: GraphWriter;
  private readonly brands: Brand[];
  private readonly clock: Clock;
  constructor(writer: GraphWriter, brands: Brand[], clock: Clock = systemClock) { this.writer = writer; this.brands = brands; this.clock = clock; }

  async ingestMany(list: Observation[]): Promise<IngestStats[]> {
    const nowIso = new Date(this.clock.now()).toISOString();
    return this.writer.applyBatches(list.map((o) => buildBatch(o, this.brands, nowIso, `auto-${this.clock.now()}-${this.seq++}`)));
  }
  async ingest(obs: Observation): Promise<IngestStats> { return (await this.ingestMany([obs]))[0] as IngestStats; }
}

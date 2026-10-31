// Evaluation harness: correlation accuracy, false-positive rate, latency, threshold sweep, ablation.
// Usage: npm run evaluate -- [--campaigns=40] [--noise=150] [--seed=42] [--dataset=path.json]
// A custom dataset file must look like: { "observations": [...], "truth": { "domain:x": "label", ... } }
import fs from 'node:fs';
import path from 'node:path';
import { config, root } from '../src/config.ts';
import { memoryAdapters, wire } from '../src/container.ts';
import { BASE_WEIGHTS, type WeightMap } from '../src/domain/correlate.ts';
import { generateDataset, type Dataset } from '../src/domain/synthetic.ts';
import type { NodeType } from '../src/domain/types.ts';

const ms = (t0: bigint): number => Number(process.hrtime.bigint() - t0) / 1e6;
const pct = (arr: number[], p: number): number => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0; };
const mean = (a: number[]): number => a.reduce((s, x) => s + x, 0) / (a.length || 1);

export interface EvalOptions { threshold?: number; maxHub?: number; weights?: Partial<WeightMap>; timing?: boolean; queries?: number }
export interface Metrics {
  correlationAccuracyPct: number; crossVectorAccuracyPct: number; falsePositiveRatePct: number;
  precisionPct: number; f1: number; counts: { tp: number; fp: number; fn: number; tn: number; xtp: number; xfn: number }; assets: number;
}
interface Spread { mean: number; p50: number; p95: number }
export interface Latency { ingestPerObservationMs: Spread; correlateAllMs: number; queryMs: Spread & { samples: number } }
export interface EvalResult { threshold: number; metrics: Metrics; latency?: Latency }

export async function evaluate(dataset: Dataset, { threshold = config.linkThreshold, maxHub = config.maxHubSize, weights, timing = false, queries = 100 }: EvalOptions = {}): Promise<EvalResult> {
  const s = wire(memoryAdapters(), { ...config, mode: 'offline' });
  const perObs: number[] = [];
  for (const o of dataset.observations) { const t = process.hrtime.bigint(); await s.ingest.ingest(o); perObs.push(ms(t)); }
  const tc = process.hrtime.bigint();
  await s.correlation.run({ threshold, maxHub, weights });
  const correlateMs = ms(tc);

  const cluster = await s.graph.clusterIdsOf(Object.keys(dataset.truth));
  const ids = Object.keys(dataset.truth).filter((id) => cluster.has(id));
  const c = { tp: 0, fp: 0, fn: 0, tn: 0, xtp: 0, xfn: 0 };
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i] as string; const b = ids[j] as string;
      const related = dataset.truth[a] === dataset.truth[b];
      const linked = cluster.get(a) === cluster.get(b);
      const cross = a.split(':')[0] !== b.split(':')[0];
      if (related && linked) { c.tp++; if (cross) c.xtp++; }
      else if (related) { c.fn++; if (cross) c.xfn++; }
      else if (linked) c.fp++;
      else c.tn++;
    }
  }
  const safe = (a: number, b: number): number => (b ? a / b : 0);
  const precision = safe(c.tp, c.tp + c.fp); const recall = safe(c.tp, c.tp + c.fn);
  const metrics: Metrics = {
    correlationAccuracyPct: +(100 * recall).toFixed(2), crossVectorAccuracyPct: +(100 * safe(c.xtp, c.xtp + c.xfn)).toFixed(2),
    falsePositiveRatePct: +(100 * safe(c.fp, c.fp + c.tn)).toFixed(4), precisionPct: +(100 * precision).toFixed(2),
    f1: +safe(2 * precision * recall, precision + recall).toFixed(4), counts: c, assets: ids.length,
  };
  const out: EvalResult = { threshold, metrics };
  if (timing) {
    const sample = Array.from({ length: Math.min(queries, ids.length) }, (_, i) => ids[Math.floor((i * ids.length) / queries)] as string);
    const q: number[] = [];
    for (const id of sample) { const t = process.hrtime.bigint(); await s.investigation.investigate(id.slice(id.indexOf(':') + 1)); q.push(ms(t)); }
    out.latency = {
      ingestPerObservationMs: { mean: +mean(perObs).toFixed(3), p50: +pct(perObs, 50).toFixed(3), p95: +pct(perObs, 95).toFixed(3) },
      correlateAllMs: +correlateMs.toFixed(1), queryMs: { mean: +mean(q).toFixed(3), p50: +pct(q, 50).toFixed(3), p95: +pct(q, 95).toFixed(3), samples: q.length },
    };
  }
  return out;
}

async function main(): Promise<void> {
  const arg = (n: string, d?: string): string | undefined => { const m = process.argv.find((a) => a.startsWith(`--${n}=`)); return m ? m.split('=')[1] : d; };
  const datasetFile = arg('dataset');
  const dataset: Dataset = datasetFile
    ? JSON.parse(fs.readFileSync(datasetFile, 'utf8')) as Dataset
    : generateDataset({ campaigns: +(arg('campaigns', '40') as string), noise: +(arg('noise', '150') as string), seed: +(arg('seed', '42') as string) });
  const base = await evaluate(dataset, { timing: true });
  const sweep = []; for (const t of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) sweep.push({ threshold: t, ...(await evaluate(dataset, { threshold: t })).metrics });
  const ablation = []; for (const type of Object.keys(BASE_WEIGHTS) as NodeType[]) ablation.push({ removed: type, ...(await evaluate(dataset, { weights: { [type]: 0 } })).metrics });
  const result = { generatedAt: new Date().toISOString(), synthetic: !datasetFile, observations: dataset.observations.length, base, sweep, ablation };

  fs.mkdirSync(path.join(root, 'results'), { recursive: true });
  fs.writeFileSync(path.join(root, 'results', 'evaluation.json'), JSON.stringify(result, null, 2));
  const m = base.metrics; const L = base.latency as Latency;
  const row = (r: Metrics & { threshold?: number; removed?: string }): string => `| ${r.threshold ?? r.removed} | ${r.correlationAccuracyPct} | ${r.crossVectorAccuracyPct} | ${r.falsePositiveRatePct} | ${r.precisionPct} | ${r.f1} |`;
  const md = [
    `# Evaluation results${result.synthetic ? ' (SYNTHETIC dataset - not thesis results)' : ''}`,
    `Observations: ${result.observations}, assets scored: ${m.assets}, threshold: ${base.threshold}`, '',
    '## Headline metrics', '| Metric | Value |', '|---|---|',
    `| Correlation accuracy (recall of related pairs) | ${m.correlationAccuracyPct}% |`, `| Cross-vector accuracy (web/crypto/mobile pairs) | ${m.crossVectorAccuracyPct}% |`,
    `| False positive rate | ${m.falsePositiveRatePct}% |`, `| Precision | ${m.precisionPct}% |`, `| F1 | ${m.f1} |`,
    `| Ingest latency per observation (mean / p95) | ${L.ingestPerObservationMs.mean} / ${L.ingestPerObservationMs.p95} ms |`,
    `| Correlation over whole graph | ${L.correlateAllMs} ms |`, `| Investigator query latency (mean / p95) | ${L.queryMs.mean} / ${L.queryMs.p95} ms |`, '',
    '## Threshold sweep', '| threshold | accuracy % | cross-vector % | FPR % | precision % | F1 |', '|---|---|---|---|---|---|', ...sweep.map(row), '',
    '## Ablation (evidence type removed)', '| removed | accuracy % | cross-vector % | FPR % | precision % | F1 |', '|---|---|---|---|---|---|', ...ablation.map(row), '',
  ].join('\n');
  fs.writeFileSync(path.join(root, 'results', 'evaluation.md'), md);
  console.log(md);
}
if (process.argv[1]?.endsWith('evaluate.ts')) await main();

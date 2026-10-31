import { officialBrand } from '../domain/assess.ts';
import { AppError } from '../domain/errors.ts';
import { extractFeatures, FEATURE_NAMES } from '../domain/ml/features.ts';
import { predictProba, trainLogistic, type TrainOptions } from '../domain/ml/logistic.ts';
import { generateDataset } from '../domain/synthetic.ts';
import type { Brand } from '../domain/types.ts';
import type { Clock, DomainClassifier, GraphReader, LabelledSet, ModelDoc, ModelRepository, TrainingDataProvider } from './ports.ts';
import { systemClock } from './ports.ts';

export const MODEL_NAME = 'domain-classifier';
const withoutOfficial = (list: string[], brands: Brand[]): string[] => list.filter((d) => !officialBrand(d, brands));

/** Demo data: look-alike campaign domains (label 1) versus ordinary domains (label 0). Good for trying the pipeline, NOT for real claims. */
export class SyntheticProvider implements TrainingDataProvider {
  readonly name = 'synthetic';
  private readonly brands: Brand[];
  private readonly benign: string[];
  constructor(brands: Brand[], benign: string[]) { this.brands = brands; this.benign = benign; }
  async load(): Promise<LabelledSet> {
    const { truth } = generateDataset({ campaigns: 120, noise: 150, seed: 11 });
    const domains: string[] = []; const labels: number[] = [];
    for (const [id, who] of Object.entries(truth)) {
      if (!id.startsWith('domain:')) continue;
      domains.push(id.slice('domain:'.length)); labels.push(who.startsWith('campaign-') ? 1 : 0);
    }
    for (const d of withoutOfficial(this.benign, this.brands)) { domains.push(d); labels.push(0); }
    return { domains, labels, source: 'synthetic demo data', synthetic: true };
  }
}

/** Real labels: domains that public blocklists (e.g. OpenPhish) flagged = 1; a benign list = 0. */
export class GraphLabelProvider implements TrainingDataProvider {
  readonly name = 'graph';
  private readonly reader: GraphReader;
  private readonly brands: Brand[];
  private readonly benign: string[];
  private readonly minPositives: number;
  constructor(reader: GraphReader, brands: Brand[], benign: string[], minPositives = 30) { this.reader = reader; this.brands = brands; this.benign = benign; this.minPositives = minPositives; }
  async load(): Promise<LabelledSet> {
    const positives = withoutOfficial(await this.reader.domainsOnAnyBlocklist(5000), this.brands);
    if (positives.length < this.minPositives) throw new AppError(400, 'not_enough_labels', `Only ${positives.length} blocklisted domains are stored; need at least ${this.minPositives}. Let the feed run, or use the synthetic demo provider.`);
    const negatives = withoutOfficial(this.benign, this.brands);
    return { domains: [...positives, ...negatives], labels: [...positives.map(() => 1), ...negatives.map(() => 0)], source: 'blocklisted domains from the database + benign list', synthetic: false };
  }
}

/** Single responsibility: own the current AI model (train, persist, load, predict). Training data comes from injected providers. */
export class ModelService implements DomainClassifier {
  private current: ModelDoc | null = null;
  private readonly repo: ModelRepository;
  private readonly brands: Brand[];
  private readonly providers: Record<string, TrainingDataProvider>;
  private readonly clock: Clock;
  constructor(repo: ModelRepository, brands: Brand[], providers: Record<string, TrainingDataProvider>, clock: Clock = systemClock) {
    this.repo = repo; this.brands = brands; this.providers = providers; this.clock = clock;
  }

  async load(): Promise<void> { this.current = await this.repo.latest(MODEL_NAME); }

  predict(domain: string): number | null {
    if (!this.current) return null;
    return predictProba(this.current.model, extractFeatures(domain.toLowerCase(), this.brands));
  }
  info(): Omit<ModelDoc, 'model'> | null {
    if (!this.current) return null;
    const { model: _model, ...rest } = this.current;
    return rest;
  }

  async train(providerName: string, opts: TrainOptions = {}): Promise<Omit<ModelDoc, 'model'>> {
    const provider = this.providers[providerName];
    if (!provider) throw new AppError(400, 'unknown_provider', `Unknown training data "${providerName}". Choose: ${Object.keys(this.providers).join(', ')}.`);
    const set = await provider.load();
    const X = set.domains.map((d) => extractFeatures(d.toLowerCase(), this.brands));
    const r = trainLogistic(X, set.labels, [...FEATURE_NAMES], opts);
    const positives = set.labels.filter((l) => l === 1).length;
    this.current = await this.repo.save({
      name: MODEL_NAME, trainedAt: new Date(this.clock.now()).toISOString(), model: r.model,
      trainedOn: { source: set.source, synthetic: set.synthetic, positives, negatives: set.labels.length - positives },
      metrics: { train: r.train, test: r.test },
    });
    return this.info() as Omit<ModelDoc, 'model'>;
  }

  /** At start-up: load the saved model, or (optionally) train the clearly-labelled demo model so the feature works out of the box. */
  async ensureModel(autoTrainDemo: boolean): Promise<void> {
    await this.load();
    if (!this.current && autoTrainDemo) await this.train('synthetic');
  }
}

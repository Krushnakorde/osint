// Logistic regression in plain TypeScript (no ML library): standardise -> class-weighted gradient descent with L2.
export interface LogisticModel { featureNames: string[]; mean: number[]; std: number[]; weights: number[]; bias: number }
export interface Metrics { n: number; accuracy: number; precision: number; recall: number; f1: number; auc: number; tp: number; fp: number; tn: number; fn: number }
export interface TrainOptions { epochs?: number; lr?: number; l2?: number; seed?: number; testFraction?: number }
export interface TrainResult { model: LogisticModel; train: Metrics; test: Metrics }

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

function prng(seed: number): () => number {
  let a = seed | 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function predictProba(m: LogisticModel, x: number[]): number {
  let z = m.bias;
  for (let i = 0; i < m.weights.length; i++) z += (m.weights[i] as number) * (((x[i] ?? 0) - (m.mean[i] as number)) / (m.std[i] as number));
  return sigmoid(z);
}

/** ROC AUC via the rank-sum (Mann-Whitney) formulation; ties get average ranks. */
export function auc(scores: number[], labels: number[]): number {
  const idx = scores.map((s, i) => [s, i] as const).sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(scores.length).fill(0);
  for (let i = 0; i < idx.length;) {
    let j = i; while (j + 1 < idx.length && idx[j + 1]![0] === idx[i]![0]) j++;
    const r = (i + j) / 2 + 1; for (let k = i; k <= j; k++) ranks[idx[k]![1]] = r; i = j + 1;
  }
  const pos = labels.filter((l) => l === 1).length; const neg = labels.length - pos;
  if (!pos || !neg) return 0.5;
  const sumPos = labels.reduce((s, l, i) => s + (l === 1 ? (ranks[i] as number) : 0), 0);
  return (sumPos - (pos * (pos + 1)) / 2) / (pos * neg);
}

export function evaluateModel(m: LogisticModel, X: number[][], y: number[]): Metrics {
  const p = X.map((x) => predictProba(m, x));
  let tp = 0, fp = 0, tn = 0, fn = 0;
  p.forEach((s, i) => { const pred = s >= 0.5 ? 1 : 0; if (pred && y[i]) tp++; else if (pred) fp++; else if (y[i]) fn++; else tn++; });
  const safe = (a: number, b: number): number => (b ? a / b : 0);
  const precision = safe(tp, tp + fp); const recall = safe(tp, tp + fn);
  const r = (v: number): number => +v.toFixed(4);
  return { n: y.length, accuracy: r(safe(tp + tn, y.length)), precision: r(precision), recall: r(recall), f1: r(safe(2 * precision * recall, precision + recall)), auc: r(auc(p, y)), tp, fp, tn, fn };
}

export function trainLogistic(X: number[][], y: number[], names: string[], opts: TrainOptions = {}): TrainResult {
  const { epochs = 600, lr = 0.2, l2 = 0.01, seed = 7, testFraction = 0.25 } = opts;
  const rnd = prng(seed);
  const byClass: number[][] = [[], []];
  y.forEach((l, i) => byClass[l === 1 ? 1 : 0]!.push(i));
  const test: number[] = []; const train: number[] = [];
  for (const group of byClass) { // stratified shuffle split
    for (let i = group.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [group[i], group[j]] = [group[j] as number, group[i] as number]; }
    const cut = Math.round(group.length * testFraction);
    test.push(...group.slice(0, cut)); train.push(...group.slice(cut));
  }
  const Xtr = train.map((i) => X[i] as number[]); const ytr = train.map((i) => y[i] as number);
  const d = names.length;
  const mean = new Array<number>(d).fill(0); const std = new Array<number>(d).fill(1);
  for (let j = 0; j < d; j++) {
    mean[j] = Xtr.reduce((s, r) => s + (r[j] as number), 0) / Xtr.length;
    std[j] = Math.sqrt(Xtr.reduce((s, r) => s + ((r[j] as number) - (mean[j] as number)) ** 2, 0) / Xtr.length) || 1;
  }
  const Z = Xtr.map((r) => r.map((v, j) => (v - (mean[j] as number)) / (std[j] as number)));
  const pos = ytr.filter((l) => l === 1).length; const neg = ytr.length - pos;
  const wPos = ytr.length / (2 * Math.max(1, pos)); const wNeg = ytr.length / (2 * Math.max(1, neg)); // balanced classes
  const w = new Array<number>(d).fill(0); let b = 0;
  for (let e = 0; e < epochs; e++) {
    const gw = new Array<number>(d).fill(0); let gb = 0;
    for (let i = 0; i < Z.length; i++) {
      let z = b; for (let j = 0; j < d; j++) z += (w[j] as number) * (Z[i]![j] as number);
      const cw = ytr[i] === 1 ? wPos : wNeg; const err = (sigmoid(z) - (ytr[i] as number)) * cw;
      for (let j = 0; j < d; j++) gw[j] = (gw[j] as number) + err * (Z[i]![j] as number);
      gb += err;
    }
    for (let j = 0; j < d; j++) w[j] = (w[j] as number) - lr * ((gw[j] as number) / Z.length + l2 * (w[j] as number));
    b -= lr * (gb / Z.length);
  }
  const model: LogisticModel = { featureNames: names, mean, std, weights: w, bias: b };
  return { model, train: evaluateModel(model, Xtr, ytr), test: evaluateModel(model, test.map((i) => X[i] as number[]), test.map((i) => y[i] as number)) };
}

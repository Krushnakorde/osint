# Evaluation results (SYNTHETIC dataset - not thesis results)
Observations: 521, assets scored: 521, threshold: 0.6

## Headline metrics
| Metric | Value |
|---|---|
| Correlation accuracy (recall of related pairs) | 69.3% |
| Cross-vector accuracy (web/crypto/mobile pairs) | 69.46% |
| False positive rate | 0% |
| Precision | 100% |
| F1 | 0.8186 |
| Ingest latency per observation (mean / p95) | 0.247 / 0.648 ms |
| Correlation over whole graph | 32.3 ms |
| Investigator query latency (mean / p95) | 0.289 / 0.79 ms |

## Threshold sweep
| threshold | accuracy % | cross-vector % | FPR % | precision % | F1 |
|---|---|---|---|---|---|
| 0.3 | 85.16 | 81.22 | 9.886 | 7.59 | 0.1394 |
| 0.4 | 81.8 | 78.38 | 0.5239 | 59.83 | 0.6911 |
| 0.5 | 73.75 | 72.3 | 0 | 100 | 0.8489 |
| 0.6 | 69.3 | 69.46 | 0 | 100 | 0.8186 |
| 0.7 | 61.95 | 63.78 | 0 | 100 | 0.7651 |
| 0.8 | 44.77 | 48.92 | 0 | 100 | 0.6185 |
| 0.9 | 2.97 | 1.76 | 0 | 100 | 0.0577 |

## Ablation (evidence type removed)
| removed | accuracy % | cross-vector % | FPR % | precision % | F1 |
|---|---|---|---|---|---|
| wallet | 69.3 | 69.46 | 0 | 100 | 0.8186 |
| apk | 69.3 | 69.46 | 0 | 100 | 0.8186 |
| signer | 66.88 | 66.49 | 0 | 100 | 0.8015 |
| tracker | 55.55 | 57.84 | 0 | 100 | 0.7142 |
| cert | 60.62 | 62.3 | 0 | 100 | 0.7549 |
| package | 69.3 | 69.46 | 0 | 100 | 0.8186 |
| ip | 54.69 | 57.3 | 0 | 100 | 0.7071 |
| nameserver | 66.88 | 67.7 | 0 | 100 | 0.8015 |
| brand | 66.64 | 67.43 | 0 | 100 | 0.7998 |
| report | 69.3 | 69.46 | 0 | 100 | 0.8186 |
| registrar | 69.3 | 69.46 | 0 | 100 | 0.8186 |
| asn | 69.3 | 69.46 | 0 | 100 | 0.8186 |
| domain | 69.3 | 69.46 | 0 | 100 | 0.8186 |
| blocklist | 69.3 | 69.46 | 0 | 100 | 0.8186 |

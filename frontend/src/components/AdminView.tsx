import { useEffect, useState } from 'react';
import { useI18n } from '../I18n.tsx';
import { getModelInfo, getStats, refreshFeeds, trainModel, triggerCorrelate } from '../api.ts';
import type { ModelResponse, Stats } from '../types.ts';

export default function AdminView() {
  const { t } = useI18n();
  const [stats, setStats] = useState<Stats | null>(null);
  const [modelData, setModelData] = useState<ModelResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [training, setTraining] = useState(false);
  const [triggeringFeed, setTriggeringFeed] = useState(false);
  const [triggeringCorrelate, setTriggeringCorrelate] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [s, m] = await Promise.all([getStats(), getModelInfo()]);
      setStats(s);
      setModelData(m);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleTrain = async (provider: 'graph' | 'synthetic') => {
    setTraining(true);
    setActionMsg(null);
    try {
      const res = await trainModel(provider);
      if ('error' in res && res.error) {
        setActionMsg({ text: res.error, error: true });
      } else {
        setActionMsg({ text: `AI Model successfully retrained with ${provider} provider!` });
        const m = await getModelInfo();
        setModelData(m);
      }
    } catch (e: unknown) {
      setActionMsg({ text: (e as Error)?.message || 'Training failed.', error: true });
    } finally {
      setTraining(false);
    }
  };

  const handleRefreshFeeds = async () => {
    setTriggeringFeed(true);
    setActionMsg(null);
    try {
      await refreshFeeds();
      setActionMsg({ text: 'Threat feeds refreshed successfully from OpenPhish.' });
      const s = await getStats();
      setStats(s);
    } catch (e: unknown) {
      setActionMsg({ text: (e as Error)?.message || 'Feed refresh failed.', error: true });
    } finally {
      setTriggeringFeed(false);
    }
  };

  const handleCorrelate = async () => {
    setTriggeringCorrelate(true);
    setActionMsg(null);
    try {
      await triggerCorrelate();
      setActionMsg({ text: 'Correlation engine ran successfully: graph clusters updated.' });
      const s = await getStats();
      setStats(s);
    } catch (e: unknown) {
      setActionMsg({ text: (e as Error)?.message || 'Correlation run failed.', error: true });
    } finally {
      setTriggeringCorrelate(false);
    }
  };

  const totalNodes = stats?.nodes
    ? Object.values(stats.nodes).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      {/* Title */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
            ⚙️ {t('nav.admin')}
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            System internals, MongoDB threat graph database telemetry, and AI ML classifier controls.
          </p>
        </div>

        <button
          onClick={() => void loadData()}
          disabled={loading}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-slate-800 hover:text-white"
        >
          🔄 Refresh Status
        </button>
      </div>

      {actionMsg && (
        <div
          className={`mb-6 rounded-xl border p-4 text-xs font-medium ${
            actionMsg.error
              ? 'border-red-500/40 bg-red-950/30 text-red-200'
              : 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200'
          }`}
        >
          {actionMsg.text}
        </div>
      )}

      {loading ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-slate-800 bg-slate-900/30 text-sm text-slate-400">
          Loading system telemetry and model state…
        </div>
      ) : (
        <div className="space-y-6">
          {/* Graph Database Stats */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur">
            <h3 className="mb-3 flex items-center justify-between text-base font-semibold text-white">
              <span>🗄️ MongoDB Threat Graph Database</span>
              <span className="rounded bg-cyan-950/80 border border-cyan-500/30 px-2 py-0.5 text-xs text-cyan-300 font-mono">
                STORAGE=mongo
              </span>
            </h3>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
              <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-3">
                <div className="text-[11px] font-medium uppercase text-slate-400">Total Nodes</div>
                <div className="mt-1 text-xl font-bold text-cyan-400">{totalNodes}</div>
              </div>
              <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-3">
                <div className="text-[11px] font-medium uppercase text-slate-400">Total Edges</div>
                <div className="mt-1 text-xl font-bold text-white">{stats?.edges ?? 0}</div>
              </div>
              <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-3">
                <div className="text-[11px] font-medium uppercase text-slate-400">Observations</div>
                <div className="mt-1 text-xl font-bold text-white">{stats?.observations ?? 0}</div>
              </div>
              <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-3">
                <div className="text-[11px] font-medium uppercase text-slate-400">Connected Clusters</div>
                <div className="mt-1 text-xl font-bold text-amber-400">{stats?.clusters ?? 0}</div>
              </div>
              <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-3">
                <div className="text-[11px] font-medium uppercase text-slate-400">Correlated Groups</div>
                <div className="mt-1 text-xl font-bold text-emerald-400">{stats?.correlatedClusters ?? 0}</div>
              </div>
            </div>

            {/* Node Breakdown chips */}
            {stats?.nodes && (
              <div className="mt-4 pt-3 border-t border-slate-800/70">
                <div className="mb-2 text-xs font-medium text-slate-400">Node Types Breakdown:</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(stats.nodes).map(([type, count]) => (
                    <span
                      key={type}
                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-950 px-2.5 py-1 text-xs text-slate-300"
                    >
                      <span className="capitalize">{type}:</span>
                      <span className="font-semibold text-cyan-400">{count}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* AI Machine Learning Classifier */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold text-white">
                  <span>🧠 AI Machine Learning Classifier</span>
                  <span className="rounded bg-purple-950/80 border border-purple-500/40 px-2 py-0.5 text-xs text-purple-300">
                    Logistic Regression L2
                  </span>
                </h3>
                <p className="mt-0.5 text-xs text-slate-400">
                  Calculates phishing & fraudulent lookalike probability from 12 lexical & structural domain features.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => void handleTrain('graph')}
                  disabled={training}
                  className="rounded-lg border border-cyan-500/40 bg-cyan-950/30 px-3 py-1.5 text-xs font-semibold text-cyan-300 transition hover:bg-cyan-900/40 disabled:opacity-50"
                >
                  {training ? 'Training…' : 'Train on Graph Feed Data'}
                </button>
                <button
                  onClick={() => void handleTrain('synthetic')}
                  disabled={training}
                  className="rounded-lg border border-purple-500/40 bg-purple-950/30 px-3 py-1.5 text-xs font-semibold text-purple-300 transition hover:bg-purple-900/40 disabled:opacity-50"
                >
                  {training ? 'Training…' : 'Train on Synthetic Dataset'}
                </button>
              </div>
            </div>

            {modelData?.model ? (
              <div className="space-y-4">
                {/* Meta details */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-3">
                    <div className="text-[11px] font-medium text-slate-400">Model Name & Ver</div>
                    <div className="mt-1 font-mono text-sm font-semibold text-white">
                      {modelData.model.name} v{modelData.model.version}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-3">
                    <div className="text-[11px] font-medium text-slate-400">Dataset Source</div>
                    <div className="mt-1 text-sm font-medium text-cyan-300">
                      {modelData.model.trainedOn.synthetic ? 'Synthetic Benchmark' : 'Live Feeds & Graph'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-3">
                    <div className="text-[11px] font-medium text-slate-400">Training Samples</div>
                    <div className="mt-1 text-sm font-medium text-slate-200">
                      <span className="text-rose-400 font-semibold">{modelData.model.trainedOn.positives}</span> fraud /{' '}
                      <span className="text-emerald-400 font-semibold">{modelData.model.trainedOn.negatives}</span> benign
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-3">
                    <div className="text-[11px] font-medium text-slate-400">Last Trained</div>
                    <div className="mt-1 text-xs text-slate-300">
                      {new Date(modelData.model.trainedAt).toLocaleString()}
                    </div>
                  </div>
                </div>

                {/* Metrics Comparison Table */}
                <div className="rounded-lg border border-slate-800 overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-800 bg-slate-950/90 text-slate-400">
                      <tr>
                        <th className="px-3 py-2">Split</th>
                        <th className="px-3 py-2">Samples</th>
                        <th className="px-3 py-2">ROC-AUC</th>
                        <th className="px-3 py-2">Accuracy</th>
                        <th className="px-3 py-2">Precision</th>
                        <th className="px-3 py-2">Recall</th>
                        <th className="px-3 py-2">F1 Score</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 text-slate-200">
                      <tr className="hover:bg-slate-800/30">
                        <td className="px-3 py-2 font-medium text-cyan-400">Test Evaluation</td>
                        <td className="px-3 py-2">{modelData.model.metrics.test.n}</td>
                        <td className="px-3 py-2 font-semibold text-emerald-400">
                          {(modelData.model.metrics.test.auc * 100).toFixed(1)}%
                        </td>
                        <td className="px-3 py-2">{(modelData.model.metrics.test.accuracy * 100).toFixed(1)}%</td>
                        <td className="px-3 py-2">{(modelData.model.metrics.test.precision * 100).toFixed(1)}%</td>
                        <td className="px-3 py-2">{(modelData.model.metrics.test.recall * 100).toFixed(1)}%</td>
                        <td className="px-3 py-2 font-semibold text-cyan-300">
                          {(modelData.model.metrics.test.f1 * 100).toFixed(1)}%
                        </td>
                      </tr>
                      <tr className="hover:bg-slate-800/30 text-slate-400">
                        <td className="px-3 py-2">Training Set</td>
                        <td className="px-3 py-2">{modelData.model.metrics.train.n}</td>
                        <td className="px-3 py-2">{(modelData.model.metrics.train.auc * 100).toFixed(1)}%</td>
                        <td className="px-3 py-2">{(modelData.model.metrics.train.accuracy * 100).toFixed(1)}%</td>
                        <td className="px-3 py-2">{(modelData.model.metrics.train.precision * 100).toFixed(1)}%</td>
                        <td className="px-3 py-2">{(modelData.model.metrics.train.recall * 100).toFixed(1)}%</td>
                        <td className="px-3 py-2">{(modelData.model.metrics.train.f1 * 100).toFixed(1)}%</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Features */}
                {modelData.features && (
                  <div className="pt-2">
                    <div className="mb-2 text-xs font-medium text-slate-400">Extracted Feature Vector:</div>
                    <div className="flex flex-wrap gap-1.5">
                      {modelData.features.map((f) => (
                        <span
                          key={f}
                          className="rounded bg-slate-950 border border-slate-800 px-2 py-0.5 font-mono text-[11px] text-cyan-300"
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4 text-center text-xs text-slate-400">
                No model loaded yet. Click "Train on Synthetic Dataset" to initialize.
              </div>
            )}
          </div>

          {/* Operational Ingest & Pipeline Controls */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur">
            <h3 className="mb-3 text-base font-semibold text-white">
              ⚡ Operational Ingest & Graph Correlation Engine
            </h3>
            <p className="mb-4 text-xs text-slate-400">
              Trigger background jobs on demand without waiting for scheduled timer intervals.
            </p>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => void handleRefreshFeeds()}
                disabled={triggeringFeed}
                className="flex items-center gap-2 rounded-lg bg-slate-800 border border-slate-700 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50"
              >
                <span>🌐</span>
                <span>{triggeringFeed ? 'Polling OpenPhish…' : 'Poll OpenPhish Threat Feed'}</span>
              </button>

              <button
                onClick={() => void handleCorrelate()}
                disabled={triggeringCorrelate}
                className="flex items-center gap-2 rounded-lg bg-slate-800 border border-slate-700 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50"
              >
                <span>🔗</span>
                <span>{triggeringCorrelate ? 'Running Correlator…' : 'Run Graph Correlation Pipeline'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

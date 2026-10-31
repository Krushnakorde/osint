import { useEffect, useState } from 'react';
import { useI18n } from '../I18n.tsx';
import { getAnalytics, type User } from '../api.ts';
import type { AnalyticsSummary, Level } from '../types.ts';
import { LEVEL_STYLE } from '../style.ts';

interface Props {
  user: User;
}

export default function AnalyticsView({ user }: Props) {
  const { t } = useI18n();
  const [scope, setScope] = useState<'me' | 'all'>(user.role === 'admin' ? 'all' : 'me');
  const [days, setDays] = useState<number>(30);
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const data = await getAnalytics(scope, days);
      setSummary(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchAnalytics();
  }, [scope, days]);

  const renderInsightText = (code: string, params: Record<string, string | number>) => {
    switch (code) {
      case 'no_data':
        return 'No search data recorded for the selected filter.';
      case 'top_query':
        return `Most checked indicator is "${params.value}" with ${params.count} queries.`;
      case 'trend':
        return `Investigation volume is trending ${params.dir} by ${params.pct}% compared to previous period.`;
      case 'flagged_share':
        return `${params.pct}% of all investigated items presented actionable fraud or scam warnings.`;
      case 'peak_hour':
        return `Highest investigator activity is concentrated at ${params.hour}:00 UTC.`;
      case 'spike':
        return `Unusual anomaly spike detected on ${params.day} (${params.count} queries).`;
      case 'live_share':
        return `${params.pct}% of requests triggered real-time live OSINT external enrichment.`;
      default:
        return `${code}: ${JSON.stringify(params)}`;
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      {/* Title & Filters */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
            📊 {t('nav.analytics')}
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Real-time telemetry, threat intelligence breakdowns, and operational forensic metrics.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {user.role === 'admin' && (
            <div className="flex overflow-hidden rounded-lg border border-slate-700 bg-slate-900 text-xs">
              <button
                onClick={() => setScope('me')}
                className={`px-3 py-1.5 font-medium transition ${
                  scope === 'me' ? 'bg-cyan-600 text-white' : 'text-slate-300 hover:text-white'
                }`}
              >
                My Activity
              </button>
              <button
                onClick={() => setScope('all')}
                className={`px-3 py-1.5 font-medium transition ${
                  scope === 'all' ? 'bg-cyan-600 text-white' : 'text-slate-300 hover:text-white'
                }`}
              >
                Global (All Users)
              </button>
            </div>
          )}

          <div className="flex overflow-hidden rounded-lg border border-slate-700 bg-slate-900 text-xs">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 font-medium transition ${
                  days === d ? 'bg-cyan-600 text-white' : 'text-slate-300 hover:text-white'
                }`}
              >
                {d} Days
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-slate-800 bg-slate-900/30 text-sm text-slate-400">
          Calculating intelligence metrics…
        </div>
      ) : !summary ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-slate-800 bg-slate-900/20 text-slate-400">
          No analytics data available.
        </div>
      ) : (
        <div className="space-y-6">
          {/* Top KPI Cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 backdrop-blur">
              <div className="text-xs font-medium uppercase tracking-wider text-slate-400">Total Checks</div>
              <div className="mt-2 text-2xl font-bold text-white sm:text-3xl">{summary.totals.searches}</div>
              <div className="mt-1 text-xs text-slate-500">Recorded investigations</div>
            </div>

            <div className="rounded-xl border border-rose-900/30 bg-rose-950/20 p-4 backdrop-blur">
              <div className="text-xs font-medium uppercase tracking-wider text-rose-300">Flagged Threats</div>
              <div className="mt-2 text-2xl font-bold text-rose-400 sm:text-3xl">{summary.totals.flagged}</div>
              <div className="mt-1 text-xs text-rose-300/60">
                {summary.totals.searches > 0
                  ? `${Math.round((summary.totals.flagged / summary.totals.searches) * 100)}% detection rate`
                  : '0% detection rate'}
              </div>
            </div>

            <div className="rounded-xl border border-cyan-900/30 bg-cyan-950/20 p-4 backdrop-blur">
              <div className="text-xs font-medium uppercase tracking-wider text-cyan-300">Live OSINT Queries</div>
              <div className="mt-2 text-2xl font-bold text-cyan-400 sm:text-3xl">{summary.totals.live}</div>
              <div className="mt-1 text-xs text-cyan-300/60">External public feeds polled</div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 backdrop-blur">
              <div className="text-xs font-medium uppercase tracking-wider text-slate-400">Average Latency</div>
              <div className="mt-2 text-2xl font-bold text-white sm:text-3xl">{summary.totals.avgLatencyMs} <span className="text-sm font-normal text-slate-400">ms</span></div>
              <div className="mt-1 text-xs text-slate-500">Database response speed</div>
            </div>
          </div>

          {/* Automated Insights */}
          {summary.insights.length > 0 && (
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/20 p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-cyan-300">
                <span>💡</span> Automated Threat Intelligence Insights
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {summary.insights.map((ins, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2.5 rounded-lg border border-cyan-500/10 bg-slate-900/70 p-3 text-xs text-slate-300"
                  >
                    <span className="text-cyan-400">•</span>
                    <span>{renderInsightText(ins.code, ins.params)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Grids: Risk breakdown & Kinds */}
          <div className="grid gap-6 md:grid-cols-2">
            {/* Risk Levels Breakdown */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <h3 className="mb-4 text-sm font-semibold text-white">Risk Verdict Breakdown</h3>
              {summary.levels.length === 0 ? (
                <p className="text-xs text-slate-500">No verdicts recorded in this window.</p>
              ) : (
                <div className="space-y-3">
                  {summary.levels.map((item) => {
                    const level = item.key as Level;
                    const theme = level in LEVEL_STYLE ? LEVEL_STYLE[level] : null;
                    const pct = summary.totals.searches > 0
                      ? Math.round((item.count / summary.totals.searches) * 100)
                      : 0;
                    return (
                      <div key={item.key}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1.5 font-medium text-slate-300">
                            {theme && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: theme.ring }} />}
                            {t(`level.${level}`)}
                          </span>
                          <span className="font-semibold text-slate-400">
                            {item.count} ({pct}%)
                          </span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              level === 'high'
                                ? 'bg-red-500'
                                : level === 'suspicious'
                                ? 'bg-orange-500'
                                : level === 'signals'
                                ? 'bg-amber-500'
                                : level === 'official'
                                ? 'bg-emerald-500'
                                : 'bg-slate-500'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Indicator Types Breakdown */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <h3 className="mb-4 text-sm font-semibold text-white">Indicator Asset Types</h3>
              {summary.kinds.length === 0 ? (
                <p className="text-xs text-slate-500">No indicators recorded yet.</p>
              ) : (
                <div className="space-y-3">
                  {summary.kinds.map((item) => {
                    const pct = summary.totals.searches > 0
                      ? Math.round((item.count / summary.totals.searches) * 100)
                      : 0;
                    return (
                      <div key={item.key}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="font-medium capitalize text-slate-300">
                            {item.key}
                          </span>
                          <span className="font-semibold text-slate-400">
                            {item.count} ({pct}%)
                          </span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                          <div
                            className="h-full rounded-full bg-cyan-500 transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Grids: Top Queries & Top Brands */}
          <div className="grid gap-6 md:grid-cols-2">
            {/* Top Queried Indicators */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <h3 className="mb-3 text-sm font-semibold text-white">Top Queried Indicators</h3>
              {summary.topQueries.length === 0 ? (
                <p className="text-xs text-slate-500">No queries recorded yet.</p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-slate-800">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-800 bg-slate-950/80 text-slate-400">
                      <tr>
                        <th className="px-3 py-2">Indicator</th>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2 text-right">Count</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 text-slate-300">
                      {summary.topQueries.slice(0, 7).map((q, idx) => (
                        <tr key={idx} className="hover:bg-slate-800/30">
                          <td className="px-3 py-2 font-mono break-all">{q.value}</td>
                          <td className="px-3 py-2 capitalize">{q.kind}</td>
                          <td className="px-3 py-2 text-right font-semibold text-cyan-400">{q.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Top Impersonated Brands */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <h3 className="mb-3 text-sm font-semibold text-white">Most Impersonated Brands</h3>
              {summary.topBrands.length === 0 ? (
                <p className="text-xs text-slate-500">No brand look-alike correlations in database.</p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-slate-800">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-800 bg-slate-950/80 text-slate-400">
                      <tr>
                        <th className="px-3 py-2">Brand Name</th>
                        <th className="px-3 py-2 text-right">Lookalike Domains</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 text-slate-300">
                      {summary.topBrands.slice(0, 7).map((b, idx) => (
                        <tr key={idx} className="hover:bg-slate-800/30">
                          <td className="px-3 py-2 font-medium capitalize text-slate-200">{b.brand}</td>
                          <td className="px-3 py-2 text-right font-semibold text-rose-400">{b.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Top Users (Admin Scope) */}
          {summary.topUsers && summary.topUsers.length > 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <h3 className="mb-3 text-sm font-semibold text-white">Investigator Activity (User Breakdown)</h3>
              <div className="overflow-hidden rounded-lg border border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-800 bg-slate-950/80 text-slate-400">
                    <tr>
                      <th className="px-3 py-2">Investigator</th>
                      <th className="px-3 py-2">Email</th>
                      <th className="px-3 py-2 text-right">Queries</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-300">
                    {summary.topUsers.map((u, idx) => (
                      <tr key={idx} className="hover:bg-slate-800/30">
                        <td className="px-3 py-2 font-medium text-slate-200">{u.name}</td>
                        <td className="px-3 py-2 font-mono text-slate-400">{u.email}</td>
                        <td className="px-3 py-2 text-right font-semibold text-cyan-400">{u.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

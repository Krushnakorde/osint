import { useEffect, useState } from 'react';
import { useI18n } from '../I18n.tsx';
import { clearHistory, deleteHistoryItem, getHistory } from '../api.ts';
import type { Level, SearchEvent } from '../types.ts';
import { LEVEL_STYLE } from '../style.ts';

interface Props {
  onSelectQuery: (q: string) => void;
}

export default function HistoryView({ onSelectQuery }: Props) {
  const { t } = useI18n();
  const [items, setItems] = useState<SearchEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await getHistory(100);
      setItems(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleDelete = async (id: string) => {
    setActionBusy(true);
    try {
      const ok = await deleteHistoryItem(id);
      if (ok) {
        setItems((prev) => prev.filter((i) => i.id !== id));
      }
    } finally {
      setActionBusy(false);
    }
  };

  const handleClear = async () => {
    if (!window.confirm('Are you sure you want to clear your entire search history?')) return;
    setActionBusy(true);
    try {
      await clearHistory();
      setItems([]);
    } finally {
      setActionBusy(false);
    }
  };

  const filtered = items.filter((i) =>
    i.value.toLowerCase().includes(filter.toLowerCase()) ||
    (i.kind && i.kind.toLowerCase().includes(filter.toLowerCase()))
  );

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
            📜 {t('nav.history')}
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            View, re-examine or delete your recent forensic queries and risk verdicts.
          </p>
        </div>
        {items.length > 0 && (
          <button
            onClick={handleClear}
            disabled={actionBusy}
            className="rounded-lg border border-red-500/40 bg-red-950/20 px-3.5 py-1.5 text-xs font-semibold text-red-300 transition hover:bg-red-900/40 hover:text-red-100 disabled:opacity-50"
          >
            Clear All History
          </button>
        )}
      </div>

      {/* Filter and stats bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3 backdrop-blur">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter history by indicator or kind…"
          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none sm:max-w-md"
        />
        <div className="text-xs text-slate-400">
          Showing <span className="font-semibold text-cyan-400">{filtered.length}</span> of {items.length} records
        </div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-slate-800 bg-slate-900/30 text-sm text-slate-400">
          Loading investigation logs…
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 bg-slate-900/20 text-center">
          <p className="text-base font-medium text-slate-300">
            {items.length === 0 ? 'No investigations found in your history.' : 'No items match your filter.'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {items.length === 0 ? 'Searches you perform in the Investigate tab will appear here.' : 'Try a different search term.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50">
          <div className="divide-y divide-slate-800/80">
            {filtered.map((item) => {
              const level = item.level as Level | null;
              const theme = level && level in LEVEL_STYLE ? LEVEL_STYLE[level] : null;
              return (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-4 transition hover:bg-slate-800/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-white break-all">
                        {item.value}
                      </span>
                      <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-300">
                        {item.kind || 'query'}
                      </span>
                      {level && theme && (
                        <span
                          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${theme.badge}`}
                        >
                          {t(`level.${level}`)}
                        </span>
                      )}
                      {item.live && (
                        <span className="rounded bg-emerald-950/60 border border-emerald-500/30 px-2 py-0.5 text-[10px] text-emerald-300 font-medium">
                          Live Lookup
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-slate-400">
                      <span>{new Date(item.createdAt).toLocaleString()}</span>
                      <span>&bull;</span>
                      <span>{item.latencyMs} ms latency</span>
                      <span>&bull;</span>
                      <span>{item.found ? 'Resolved in graph' : 'Not previously observed'}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onSelectQuery(item.value)}
                      className="rounded-lg bg-cyan-600/90 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-cyan-500"
                    >
                      Investigate
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      disabled={actionBusy}
                      title="Delete record"
                      className="rounded-lg border border-slate-700 bg-slate-950 p-1.5 text-slate-400 transition hover:border-red-500/50 hover:bg-red-950/30 hover:text-red-300 disabled:opacity-50"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

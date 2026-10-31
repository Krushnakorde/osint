import { useI18n } from '../I18n.tsx';
import type { LiveSummary } from '../types.ts';

export default function LiveStatus({ live }: { live: LiveSummary | undefined }) {
  const { t } = useI18n();
  if (!live || live.sources.length === 0) return null;
  const ok = live.sources.filter((s) => s.ok).length;
  return (
    <details className="border-b border-slate-800 bg-slate-900/40 px-4 py-2 text-xs sm:px-6">
      <summary className="mx-auto max-w-7xl cursor-pointer text-slate-400">
        {t('live.title')}: {t('live.summary', { ok, total: live.sources.length })} · {live.stored ? t('live.saved') : t('live.notsaved')}
      </summary>
      <div className="mx-auto mt-2 flex max-w-7xl flex-wrap gap-2">
        {live.sources.map((s) => (
          <span key={s.source} title={s.note ?? ''}
            className={`rounded px-2 py-0.5 ${!s.ok ? 'bg-red-950 text-red-300' : s.found ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
            {s.source}: {!s.ok ? t('live.failed') : s.found ? t('live.found') : t('live.empty')}
          </span>
        ))}
      </div>
    </details>
  );
}

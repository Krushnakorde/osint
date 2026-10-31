import { useI18n } from '../I18n.tsx';
import { LEVEL_STYLE } from '../style.ts';
import type { RecentItem } from '../types.ts';

const EXAMPLES = ['paypal.com', 'onlinesbi.sbi', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'];

interface Props { recent: RecentItem[]; onPick: (q: string) => void }

export default function Home({ recent, onPick }: Props) {
  const { t } = useI18n();
  const steps = [1, 2, 3] as const;
  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-8 sm:px-6">
      <p className="text-center text-lg text-slate-300">{t('app.tagline')}</p>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">{t('home.how.title')}</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {steps.map((n) => (
            <div key={n} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <h3 className="font-semibold text-cyan-300">{t(`home.step${n}.title`)}</h3>
              <p className="mt-1 text-sm text-slate-300">{t(`home.step${n}.text`)}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">{t('home.try')}</h2>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((e) => (
            <button key={e} onClick={() => onPick(e)} className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 font-mono text-xs text-slate-200 hover:border-cyan-500">{e}</button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">{t('home.recent.title')}</h2>
        {recent.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">{t('home.recent.empty')}</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {recent.map((r) => (
              <li key={r.value}>
                <button onClick={() => onPick(r.value)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-left hover:border-cyan-600">
                  <span className="truncate font-mono text-sm text-slate-100">{r.value}</span>
                  <span className={`shrink-0 rounded border px-2 py-0.5 text-xs ${LEVEL_STYLE[r.assessment.level].badge}`}>{t(`level.${r.assessment.level}`)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-center text-xs text-slate-500">{t('verdict.disclaimer')}</p>
    </div>
  );
}

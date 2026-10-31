import { useI18n } from '../I18n.tsx';
import { LEVEL_STYLE } from '../style.ts';
import { capitalize } from '../explain.ts';
import type { Assessment } from '../types.ts';

interface Props { value: string; typeKey: string; assessment: Assessment }

export default function VerdictCard({ value, typeKey, assessment }: Props) {
  const { t } = useI18n();
  const s = LEVEL_STYLE[assessment.level];
  const brand = String(assessment.reasons.find((r) => r.code === 'official_brand')?.params?.brand ?? '');
  const info = assessment.reasons.find((r) => r.code === 'infra_summary')?.params ?? {};
  const reasons = assessment.reasons.filter((r) => r.code !== 'infra_summary');
  return (
    <section className={`rounded-xl border-2 bg-slate-900/70 p-4 ${s.border}`}>
      <p className="text-xs uppercase tracking-wide text-slate-400">{t(typeKey)}</p>
      <p className="break-all font-mono text-base text-slate-100">{value}</p>
      <div className={`mt-3 inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-lg font-semibold ${s.badge}`}>
        <span aria-hidden>{s.icon}</span>{assessment.level === 'official' && brand ? `${t('level.official')}: ${capitalize(brand)}` : t(`level.${assessment.level}`)}
      </div>
      <p className="mt-2 text-sm text-slate-200">{t(`summary.${assessment.level}`, { brand: capitalize(brand), n: info.n ?? 0, flagged: info.flagged ?? 0 })}</p>
      {reasons.length > 0 && (
        <div className="mt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('verdict.why')}</h3>
          <ul className="mt-1 space-y-1 text-sm text-slate-200">
            {reasons.map((r, i) => (
              <li key={`${r.code}${i}`} className="flex gap-2"><span className={s.text} aria-hidden>•</span><span>{t(`reason.${r.code}`, { ...r.params, brand: capitalize(String(r.params?.brand ?? '')) })}</span></li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 border-t border-slate-800 pt-2 text-xs text-slate-500">{t('verdict.disclaimer')}</p>
    </section>
  );
}

import { useI18n } from '../I18n.tsx';
import type { Investigation } from '../types.ts';

export default function TechnicalDetails({ result }: { result: Investigation }) {
  const { t } = useI18n();
  return (
    <details className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 text-xs text-slate-400">
      <summary className="cursor-pointer text-slate-300">{t('tech.title')}</summary>
      <p className="mt-2 text-slate-500">{t('tech.strength.help')}</p>
      <ul className="mt-2 space-y-1">
        {result.clusters.map((c) => (
          <li key={c.id} className="font-mono">
            {t('tech.group')} {c.id} · {t('tech.strength')} {c.confidence === null ? '–' : `${Math.round(c.confidence * 100)}%`} · {c.size} · {c.vectors.map((v) => t(`vec.${v}`)).join(', ')}
          </li>
        ))}
        <li>{t('tech.points')}: {result.assessment.score ?? '–'}</li>
        {result.latencyMs !== undefined && <li>{t('tech.latency')} {result.latencyMs.toFixed(1)} ms</li>}
      </ul>
    </details>
  );
}

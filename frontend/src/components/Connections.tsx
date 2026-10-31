import { useState } from 'react';
import { useI18n } from '../I18n.tsx';
import { LEVEL_STYLE } from '../style.ts';
import { connectionText, shorten, strengthKey, valueOf } from '../explain.ts';
import type { AssetView, LinkEvidence } from '../types.ts';

interface Props { assets: AssetView[]; evidence: LinkEvidence[]; queryId: string; onPick: (value: string) => void }

export default function Connections({ assets, evidence, queryId, onPick }: Props) {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  const others = assets.filter((a) => a.id !== queryId);
  const byId = new Map(assets.map((a) => [a.id, a]));
  const pairs = all ? evidence : evidence.slice(0, 4);
  const name = (id: string): string => `${t(`type.${byId.get(id)?.type ?? id.split(':')[0]}`)}: ${shorten(valueOf(id), 30)}`;
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <h2 className="text-sm font-semibold text-slate-200">{t('conn.title')}</h2>
      <p className="mb-3 text-xs text-slate-400">{t('conn.help')}</p>
      {others.length === 0 ? <p className="text-sm text-slate-400">{t('conn.empty')}</p> : (
        <>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('conn.items')} ({others.length})</h3>
          <ul className="mb-4 max-h-56 space-y-1 overflow-y-auto pr-1">
            {others.slice(0, 40).map((a) => (
              <li key={a.id}>
                <button onClick={() => onPick(a.value)} className="flex w-full items-center justify-between gap-2 rounded border border-slate-800 px-2 py-1 text-left text-sm hover:border-cyan-600">
                  <span className="min-w-0"><span className="text-xs text-slate-400">{t(`type.${a.type}`)} </span><span className="break-all font-mono text-xs text-slate-100">{shorten(a.value, 34)}</span></span>
                  <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] ${LEVEL_STYLE[a.assessment.level].badge}`}>{t(`level.${a.assessment.level}`)}</span>
                </button>
              </li>
            ))}
          </ul>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('conn.why')}</h3>
          <ul className="space-y-2">
            {pairs.map((p) => (
              <li key={p.a + p.b} className="rounded-lg border border-slate-800 p-2 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 break-all text-xs text-slate-300">{name(p.a)} <span className="text-slate-500">↔</span> {name(p.b)}</p>
                  <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-cyan-300">{t(strengthKey(p.score))}</span>
                </div>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-200">
                  {p.evidence.slice(0, 3).map((e) => { const c = connectionText(e); return <li key={e.via}>{t(c.key, c.params)}</li>; })}
                </ul>
              </li>
            ))}
          </ul>
          {evidence.length > 4 && (
            <button onClick={() => setAll(!all)} className="mt-2 text-xs text-cyan-400 hover:underline">{all ? t('conn.less') : t('conn.more', { n: evidence.length - 4 })}</button>
          )}
        </>
      )}
    </section>
  );
}

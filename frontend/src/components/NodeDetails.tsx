import { useI18n } from '../I18n.tsx';
import { LEVEL_STYLE, TYPE_COLORS } from '../style.ts';
import { ASSET_TYPES } from '../style.ts';
import { capitalize, daysSince } from '../explain.ts';
import type { AssetView, GraphNode } from '../types.ts';

interface Props { node: GraphNode | null; assets: AssetView[]; onCheck: (value: string) => void }

export default function NodeDetails({ node, assets, onCheck }: Props) {
  const { t } = useI18n();
  if (!node) return null;
  const a = assets.find((x) => x.id === node.id)?.assessment;
  const registered = typeof node.meta.registered === 'string' ? node.meta.registered : null;
  const checkable = node.type === 'domain' || node.type === 'ip' || node.type === 'wallet' || node.type === 'apk';
  return (
    <section className="rounded-xl border border-cyan-800 bg-slate-900/70 p-3 text-sm">
      <p className="text-xs uppercase tracking-wide text-slate-400">{t('node.selected')}</p>
      <p className="mt-1" style={{ color: TYPE_COLORS[node.type] }}>{t(`type.${node.type}`)}</p>
      <p className="break-all font-mono text-xs text-slate-100">{node.value}</p>
      {a && ASSET_TYPES.has(node.type) && (
        <p className="mt-2"><span className="text-slate-400">{t('node.verdict')}: </span><span className={LEVEL_STYLE[a.level].text}>{t(`level.${a.level}`)}</span>
          {a.reasons[0] && a.reasons[0].code !== 'no_signals' && <span className="block text-xs text-slate-300">{t(`reason.${a.reasons[0].code}`, { ...a.reasons[0].params, brand: capitalize(String(a.reasons[0].params?.brand ?? '')) })}</span>}
        </p>
      )}
      {registered && <p className="mt-1 text-xs text-slate-400">{t('facts.registered')}: {registered.slice(0, 10)} ({t('facts.age', { days: daysSince(registered) })})</p>}
      {checkable && <button onClick={() => onCheck(node.value)} className="mt-2 rounded bg-cyan-700 px-3 py-1 text-xs text-white hover:bg-cyan-600">{t('node.check')}</button>}
    </section>
  );
}

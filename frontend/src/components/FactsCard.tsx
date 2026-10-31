import { useI18n } from '../I18n.tsx';
import { capitalize, daysSince } from '../explain.ts';
import type { Facts } from '../types.ts';

export default function FactsCard({ facts }: { facts: Facts | null }) {
  const { t, lang } = useI18n();
  if (!facts) return null;
  const rows: Array<[string, string]> = [];
  if (facts.registered) rows.push([t('facts.registered'), `${new Date(facts.registered).toLocaleDateString(lang === 'mr' ? 'mr-IN' : 'en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} (${t('facts.age', { days: daysSince(facts.registered) })})`]);
  if (facts.registrar) rows.push([t('facts.registrar'), capitalize(facts.registrar)]);
  if (facts.ips.length) rows.push([t('facts.server'), facts.ips.join(', ')]);
  if (facts.nameservers.length) rows.push([t('facts.dns'), facts.nameservers.join(', ')]);
  if (facts.brand) rows.push([t('facts.imitates'), capitalize(facts.brand)]);
  if (facts.blocklists.length) rows.push([t('facts.listed'), facts.blocklists.join(', ')]);
  if (facts.reports.length) rows.push([t('facts.reports'), String(facts.reports.length)]);
  if (facts.certificates) rows.push([t('facts.cert'), String(facts.certificates)]);
  if (rows.length === 0) return null;
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <h2 className="mb-2 text-sm font-semibold text-slate-200">{t('facts.title')}</h2>
      <dl className="space-y-1.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[9rem_1fr] gap-2"><dt className="text-slate-400">{k}</dt><dd className="break-all text-slate-100">{v}</dd></div>
        ))}
      </dl>
    </section>
  );
}

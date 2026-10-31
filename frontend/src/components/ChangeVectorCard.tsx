import { useI18n } from '../I18n.tsx';
import type { ChangeVector, Vector } from '../types.ts';

interface Props {
  changeVector?: ChangeVector | null;
}

const VECTOR_ICONS: Record<Vector, { icon: string; label: string; color: string }> = {
  web: { icon: '🌐', label: 'Web (Domains)', color: 'border-cyan-500/40 bg-cyan-950/40 text-cyan-300' },
  mobile: { icon: '📱', label: 'Mobile (APK Malware)', color: 'border-purple-500/40 bg-purple-950/40 text-purple-300' },
  crypto: { icon: '💰', label: 'Crypto (Wallets)', color: 'border-amber-500/40 bg-amber-950/40 text-amber-300' },
  email: { icon: '📧', label: 'Email (Phishing)', color: 'border-sky-500/40 bg-sky-950/40 text-sky-300' },
  telecom: { icon: '📞', label: 'Telecom (SMS / Smishing)', color: 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300' },
};

export default function ChangeVectorCard({ changeVector }: Props) {
  const { t } = useI18n();

  if (!changeVector || (changeVector.activeVectors.length <= 1 && changeVector.vectorTransitions.length === 0 && changeVector.churn.certChanges <= 1 && changeVector.churn.ipMigrations <= 1)) {
    return null;
  }

  const { activeVectors, vectorTransitions, churn, summary } = changeVector;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-lg backdrop-blur">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          <span>🔄</span>
          <span>{t('change.title')}</span>
        </h3>
        {activeVectors.length > 1 && (
          <span className="rounded-full border border-rose-500/40 bg-rose-950/40 px-2 py-0.5 text-[11px] font-semibold text-rose-300">
            Multi-Vector ({activeVectors.length})
          </span>
        )}
      </div>

      <p className="mb-4 text-xs leading-relaxed text-slate-300">
        {summary}
      </p>

      {/* Active Attack Vectors */}
      <div className="mb-4">
        <div className="mb-1.5 text-[11px] font-medium text-slate-400">Active Campaign Attack Vectors:</div>
        <div className="flex flex-wrap gap-1.5">
          {activeVectors.map((v) => {
            const meta = VECTOR_ICONS[v] ?? { icon: '⚡', label: v, color: 'border-slate-700 bg-slate-800 text-slate-300' };
            return (
              <span
                key={v}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium ${meta.color}`}
              >
                <span>{meta.icon}</span>
                <span>{meta.label}</span>
              </span>
            );
          })}
        </div>
      </div>

      {/* Vector Transitions Chain */}
      {vectorTransitions.length > 0 && (
        <div className="mb-4 rounded-lg border border-slate-800/80 bg-slate-950/60 p-3">
          <div className="mb-2 text-[11px] font-medium text-slate-400">
            {t('change.transitions')}:
          </div>
          <div className="space-y-1.5">
            {vectorTransitions.map((tr, idx) => (
              <div key={idx} className="flex items-center gap-2 font-mono text-xs text-cyan-300">
                <span className="text-cyan-500">▶</span>
                <span>{tr}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Infrastructure Churn Metrics */}
      <div>
        <div className="mb-2 text-[11px] font-medium text-slate-400">
          {t('change.churn')}:
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-2 text-center">
            <div className="text-[10px] text-slate-400">{t('change.cert_changes')}</div>
            <div className={`mt-0.5 text-base font-bold ${churn.certChanges > 1 ? 'text-amber-400' : 'text-slate-200'}`}>
              {churn.certChanges}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-2 text-center">
            <div className="text-[10px] text-slate-400">{t('change.ip_migrations')}</div>
            <div className={`mt-0.5 text-base font-bold ${churn.ipMigrations > 1 ? 'text-amber-400' : 'text-slate-200'}`}>
              {churn.ipMigrations}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-2 text-center">
            <div className="text-[10px] text-slate-400">{t('change.ns_rotations')}</div>
            <div className={`mt-0.5 text-base font-bold ${churn.nameserverRotations > 1 ? 'text-amber-400' : 'text-slate-200'}`}>
              {churn.nameserverRotations}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-2 text-center">
            <div className="text-[10px] text-slate-400">{t('change.reports')}</div>
            <div className={`mt-0.5 text-base font-bold ${churn.historicalReports > 0 ? 'text-rose-400' : 'text-slate-200'}`}>
              {churn.historicalReports}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * ============================================================================
 * COMPONENT: Forensic Threat Verdict Card
 * FILE: frontend/src/components/VerdictCard.tsx
 * ============================================================================
 *
 * WHAT THIS COMPONENT DOES:
 * -------------------------
 * This React component renders the top-level plain-language forensic assessment
 * for an investigated threat indicator.
 *
 * KEY UI & EXPLAINABILITY FEATURES:
 * ---------------------------------
 * 1. Threat Level Badges & Color Coding:
 *    - Green: 'official' (Known verified domain of legitimate brands, e.g. sbi.co.in).
 *    - Red: 'high' (Confirmed malicious asset on active blocklists or high-risk cluster).
 *    - Amber: 'suspicious' (Brand look-alike, fresh domain, or shared fraud infrastructure).
 *    - Blue: 'info' (Infrastructure node like IP or nameserver summarizing connected assets).
 *    - Gray: 'none' (No observed signals; careful disclaimer that absence != safe).
 *
 * 2. Deterministic Human-Readable Explainability:
 *    Cybersecurity examiners and analysts require clear reasons behind every score.
 *    Instead of an opaque number, this card lists bullet points explaining EXACTLY
 *    why the indicator was scored (e.g. typosquat distance, bulletproof ASN, blocklist name).
 *
 * 3. Internationalization (i18n):
 *    All labels, badges, and reason texts are dynamically translated via `useI18n()`.
 * ============================================================================
 */

import { useI18n } from '../I18n.tsx';
import { LEVEL_STYLE } from '../style.ts';
import { capitalize } from '../explain.ts';
import type { Assessment } from '../types.ts';

/** Component properties */
interface Props {
  value: string;         // The indicator string (e.g. "sbi-kyc-update.com")
  typeKey: string;       // Translation key for the indicator type (e.g. "type.domain")
  assessment: Assessment; // Assessment payload containing level, score, and reasons
}

export default function VerdictCard({ value, typeKey, assessment }: Props) {
  const { t } = useI18n();

  // Retrieve styling configuration (border colors, badge styling, icons)
  const s = LEVEL_STYLE[assessment.level];

  // Extract target brand name if this is an official domain or look-alike
  const brand = String(
    assessment.reasons.find((r) => r.code === 'official_brand')?.params?.brand ?? ''
  );

  // Extract summary stats if this is an infrastructure summary
  const info = assessment.reasons.find((r) => r.code === 'infra_summary')?.params ?? {};

  // Filter out internal summary markers to isolate actionable forensic reasons
  const reasons = assessment.reasons.filter((r) => r.code !== 'infra_summary');

  return (
    <section className={`rounded-xl border-2 bg-slate-900/70 p-4 ${s.border}`}>
      {/* Indicator Type Header (e.g. "DOMAIN NAME", "PHONE NUMBER") */}
      <p className="text-xs uppercase tracking-wide text-slate-400">{t(typeKey)}</p>

      {/* Target Indicator Value */}
      <p className="break-all font-mono text-base text-slate-100">{value}</p>

      {/* Threat Level Badge with Icon */}
      <div
        className={`mt-3 inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-lg font-semibold ${s.badge}`}
      >
        <span aria-hidden>{s.icon}</span>
        {assessment.level === 'official' && brand
          ? `${t('level.official')}: ${capitalize(brand)}`
          : t(`level.${assessment.level}`)}
      </div>

      {/* High-Level Narrative Summary */}
      <p className="mt-2 text-sm text-slate-200">
        {t(`summary.${assessment.level}`, {
          brand: capitalize(brand),
          n: info.n ?? 0,
          flagged: info.flagged ?? 0,
        })}
      </p>

      {/* Bulleted Forensic Explainability List */}
      {reasons.length > 0 && (
        <div className="mt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {t('verdict.why')}
          </h3>
          <ul className="mt-1 space-y-1 text-sm text-slate-200">
            {reasons.map((r, i) => (
              <li key={`${r.code}${i}`} className="flex gap-2">
                <span className={s.text} aria-hidden>
                  •
                </span>
                <span>
                  {t(`reason.${r.code}`, {
                    ...r.params,
                    brand: capitalize(String(r.params?.brand ?? '')),
                  })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Legal & Operational Disclaimer */}
      <p className="mt-3 border-t border-slate-800 pt-2 text-xs text-slate-500">
        {t('verdict.disclaimer')}
      </p>
    </section>
  );
}

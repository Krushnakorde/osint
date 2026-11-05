import { useState, type FormEvent } from 'react';
import { useI18n } from '../I18n.tsx';
import { analyzeMessageApi } from '../api.ts';
import type { SmishingAnalysis } from '../types.ts';

interface Props {
  onInvestigate: (q: string) => void;
}

const SAMPLE_ITEMS = [
  {
    title: '📞 Phone Only: +919876543210',
    sender: '+919876543210',
    text: '',
  },
  {
    title: '📞 International: +12025550188',
    sender: '+12025550188',
    text: '',
  },
  {
    title: '⚡ Electricity Disconnect Scam',
    sender: '+919876543210',
    text: 'Dear consumer, your electricity power will be disconnected tonight at 9:30 PM from the electricity office because your previous month bill was not updated. Please immediately update your bill or contact our electricity officer at +919876543210 or visit https://bill-mahadiscom-pay.top to avoid disconnection.',
  },
  {
    title: '🏦 SBI KYC Blocked Scam',
    sender: '+918888877777',
    text: 'Dear Customer, your SBI Bank account has been suspended today due to KYC expiration. Please click http://sbi-pan-kyc.xyz to update your PAN and Aadhaar immediately within 24 hours to keep services active.',
  },
  {
    title: '💼 Part-Time Job Lure',
    sender: '+12025550188',
    text: 'Congratulations! You have been selected for an online YouTube video review job. Earn Rs 3000 to Rs 8000 daily from home. Join our Telegram manager @task_payout_manager or message +917654321098 to claim your welcome bonus of Rs 500 now.',
  },
];

export default function SmishingView({ onInvestigate }: Props) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [sender, setSender] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<SmishingAnalysis | null>(null);

  const handleAnalyze = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (!text.trim() && !sender.trim()) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await analyzeMessageApi(text.trim() || undefined, sender.trim() || undefined);
      setResult(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Analysis failed. Please check your network.');
    } finally {
      setLoading(false);
    }
  };

  const loadSample = (sample: typeof SAMPLE_ITEMS[0]) => {
    setText(sample.text);
    setSender(sample.sender);
    setResult(null);
    setErrorMsg(null);
  };

  const clearForm = () => {
    setText('');
    setSender('');
    setResult(null);
    setErrorMsg(null);
  };

  const primaryTarget = sender.trim() || (result?.extracted.phones[0] ?? '');

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      {/* Title */}
      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-2xl">
          💬 {t('smish.title')}
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {t('smish.subtitle')}
        </p>
      </div>

      {/* Quick Samples */}
      <div className="mb-5">
        <div className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
          {t('smish.samples')}:
        </div>
        <div className="flex flex-wrap gap-2">
          {SAMPLE_ITEMS.map((s, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => loadSample(s)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm transition hover:border-cyan-500 hover:bg-cyan-50 hover:text-cyan-800 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-300 dark:hover:border-cyan-500/50 dark:hover:bg-cyan-950/30 dark:hover:text-white"
            >
              {s.title}
            </button>
          ))}
        </div>
      </div>

      {/* Input Form */}
      <form onSubmit={handleAnalyze} className="mb-8 space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 dark:border-slate-800 dark:bg-slate-900/60 dark:backdrop-blur">
        {/* Phone / Sender Input (First & Primary) */}
        <div>
          <label className="mb-1.5 flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200">
            <span>📱 {t('smish.phone_label')}</span>
            <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">Can be entered alone</span>
          </label>
          <input
            type="text"
            value={sender}
            onChange={(e) => setSender(e.target.value)}
            placeholder={t('smish.sender_placeholder')}
            className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 transition focus:border-cyan-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder-slate-500"
          />
        </div>

        {/* Message Textarea (Optional) */}
        <div>
          <label className="mb-1.5 flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200">
            <span>💬 {t('smish.text_label')}</span>
            <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">Optional</span>
          </label>
          <textarea
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Dear customer, your account will be suspended. Verify here: https://phish-link.com or call +91..."
            className="w-full rounded-lg border border-slate-300 bg-slate-50 p-3 text-sm text-slate-900 placeholder-slate-400 transition focus:border-cyan-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder-slate-500"
          />
        </div>

        {errorMsg && (
          <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-400">
            {errorMsg}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {sender.trim() && !text.trim()
              ? 'Checking phone number against fraud database and threat graph...'
              : 'Enter a phone number, message text, or both.'}
          </div>
          <div className="flex items-center gap-2">
            {(text.trim() || sender.trim() || result) && (
              <button
                type="button"
                onClick={clearForm}
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Clear
              </button>
            )}
            <button
              type="submit"
              disabled={loading || (!text.trim() && !sender.trim())}
              className="rounded-lg bg-cyan-600 px-5 py-2 text-xs font-semibold text-white shadow-md shadow-cyan-900/20 transition hover:bg-cyan-500 disabled:opacity-50"
            >
              {loading
                ? 'Analyzing…'
                : sender.trim() && !text.trim()
                ? '🔍 Check Phone & Scan History'
                : t('smish.button')}
            </button>
          </div>
        </div>
      </form>

      {/* Analysis Results */}
      {result && (
        <div className="space-y-6">
          {/* Related Scan & Intelligence History Card (Highlighted feature) */}
          {result.relatedScan && (
            <div className="rounded-xl border border-cyan-200 bg-cyan-50/50 p-5 shadow-sm dark:border-cyan-800/60 dark:bg-cyan-950/20">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-200/60 pb-3 dark:border-cyan-800/40">
                <div className="flex items-center gap-2">
                  <span className="text-xl">🗂️</span>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      {t('smish.scanned_status')}
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      Target: <span className="font-mono font-semibold text-cyan-700 dark:text-cyan-300">{primaryTarget || 'Queried target'}</span>
                    </p>
                  </div>
                </div>

                {/* Scan Status Badge */}
                <div className="flex items-center gap-2">
                  {result.relatedScan.scannedBefore || result.relatedScan.foundInGraph ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border dark:border-emerald-700/50">
                      ✓ {t('smish.scanned_yes')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      ℹ️ {t('smish.scanned_no')}
                    </span>
                  )}
                </div>
              </div>

              {/* Summary note */}
              <p className="mt-3 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                {result.relatedScan.summaryNote}
              </p>

              {/* Stats Grid */}
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                  <div className="text-[10px] font-medium uppercase text-slate-500 dark:text-slate-400">Total Scans</div>
                  <div className="mt-0.5 text-lg font-bold text-slate-900 dark:text-white">
                    {result.relatedScan.scanCount}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                  <div className="text-[10px] font-medium uppercase text-slate-500 dark:text-slate-400">Threat Graph</div>
                  <div className="mt-0.5 text-sm font-bold text-slate-900 dark:text-white">
                    {result.relatedScan.foundInGraph ? 'Indexed' : 'Not Recorded'}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                  <div className="text-[10px] font-medium uppercase text-slate-500 dark:text-slate-400">Graph Risk</div>
                  <div className="mt-0.5 text-sm font-bold text-slate-900 dark:text-white">
                    {result.relatedScan.riskLevel || 'UNKNOWN'}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                  <div className="text-[10px] font-medium uppercase text-slate-500 dark:text-slate-400">Linked Assets</div>
                  <div className="mt-0.5 text-lg font-bold text-slate-900 dark:text-white">
                    {result.relatedScan.linkedAssetsCount}
                  </div>
                </div>
              </div>

              {/* Threat Flags */}
              {result.relatedScan.threatFlags && result.relatedScan.threatFlags.length > 0 && (
                <div className="mt-3">
                  <div className="mb-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">Threat Indicators / Flags:</div>
                  <div className="flex flex-wrap gap-1.5">
                    {result.relatedScan.threatFlags.map((flag, idx) => (
                      <span key={idx} className="rounded bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-800 dark:bg-rose-950/60 dark:text-rose-300">
                        ⚠️ {flag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Quick Action Button */}
              {primaryTarget && (
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => onInvestigate(primaryTarget)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-700 px-4 py-2 text-xs font-semibold text-white shadow transition hover:bg-cyan-600 dark:bg-cyan-600 dark:hover:bg-cyan-500"
                  >
                    🌐 {t('smish.investigate_now')}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Main Verdict Card */}
          <div
            className={`rounded-xl border p-5 shadow-sm ${
              result.isSmishing
                ? 'border-rose-300 bg-rose-50/70 dark:border-rose-500/50 dark:bg-rose-950/20'
                : result.riskScore >= 30
                ? 'border-amber-300 bg-amber-50/70 dark:border-amber-500/50 dark:bg-amber-950/20'
                : 'border-emerald-300 bg-emerald-50/70 dark:border-emerald-500/50 dark:bg-emerald-950/20'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{result.isSmishing ? '⚠️' : '✓'}</span>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                    {result.isSmishing
                      ? 'Likely Smishing / Fraud Trap'
                      : result.riskScore >= 30
                      ? 'Suspicious Activity Detected'
                      : 'Low Suspicion Detected'}
                  </h3>
                </div>
                <p className="mt-1 text-xs text-slate-700 dark:text-slate-300">
                  {result.senderHeader.note}
                </p>
              </div>

              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {t('smish.score')}
                  </div>
                  <div
                    className={`text-2xl font-bold ${
                      result.riskScore >= 60
                        ? 'text-rose-600 dark:text-rose-400'
                        : result.riskScore >= 30
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    {result.riskScore} <span className="text-xs font-normal text-slate-500 dark:text-slate-400">/ 100</span>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
                  <div className="text-[10px] text-slate-500 dark:text-slate-400">{t('smish.urgency')}</div>
                  <div className="text-xs font-bold uppercase text-slate-900 dark:text-white">{result.urgencyLevel}</div>
                </div>
              </div>
            </div>

            {/* Reasons List */}
            {result.reasons && result.reasons.length > 0 && (
              <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-800/80">
                <div className="mb-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Signals & Analysis:
                </div>
                <ul className="space-y-1 text-xs text-slate-700 dark:text-slate-300">
                  {result.reasons.map((r, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-cyan-600 dark:text-cyan-400">•</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Extracted Indicators Section */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
            <h4 className="mb-4 text-sm font-semibold text-slate-900 dark:text-white">
              🔍 {t('smish.extracted')} (Pivots for Investigation)
            </h4>

            <div className="space-y-4">
              {/* Extracted Domains */}
              <div>
                <div className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-400">
                  Web Links & Phishing Domains ({result.extracted.domains.length}):
                </div>
                {result.extracted.domains.length === 0 ? (
                  <p className="text-xs italic text-slate-400 dark:text-slate-500">No web links detected.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {result.extracted.domains.map((d) => (
                      <div
                        key={d}
                        className="flex items-center gap-2 rounded-lg border border-cyan-300 bg-cyan-50/60 px-3 py-1.5 dark:border-cyan-500/30 dark:bg-slate-950"
                      >
                        <span className="font-mono text-xs font-semibold text-cyan-800 dark:text-cyan-300">{d}</span>
                        <button
                          type="button"
                          onClick={() => onInvestigate(d)}
                          className="rounded bg-cyan-600 px-2 py-0.5 text-[10px] font-medium text-white transition hover:bg-cyan-500"
                        >
                          {t('smish.investigate')}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Extracted Phones */}
              <div>
                <div className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-400">
                  Phone Numbers & Sender Contacts ({result.extracted.phones.length}):
                </div>
                {result.extracted.phones.length === 0 ? (
                  <p className="text-xs italic text-slate-400 dark:text-slate-500">No phone numbers extracted.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {result.extracted.phones.map((p) => (
                      <div
                        key={p}
                        className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50/60 px-3 py-1.5 dark:border-emerald-500/30 dark:bg-slate-950"
                      >
                        <span className="font-mono text-xs font-semibold text-emerald-800 dark:text-emerald-300">{p}</span>
                        <button
                          type="button"
                          onClick={() => onInvestigate(p)}
                          className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-medium text-white transition hover:bg-emerald-500"
                        >
                          {t('smish.investigate')}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Extracted Emails */}
              {result.extracted.emails.length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-400">
                    Email Addresses ({result.extracted.emails.length}):
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {result.extracted.emails.map((em) => (
                      <div
                        key={em}
                        className="flex items-center gap-2 rounded-lg border border-sky-300 bg-sky-50/60 px-3 py-1.5 dark:border-sky-500/30 dark:bg-slate-950"
                      >
                        <span className="font-mono text-xs font-semibold text-sky-800 dark:text-sky-300">{em}</span>
                        <button
                          type="button"
                          onClick={() => onInvestigate(em)}
                          className="rounded bg-sky-600 px-2 py-0.5 text-[10px] font-medium text-white transition hover:bg-sky-500"
                        >
                          {t('smish.investigate')}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Extracted UPI handles */}
              {result.extracted.upi.length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-400">
                    UPI Payment Handles ({result.extracted.upi.length}):
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {result.extracted.upi.map((u) => (
                      <div
                        key={u}
                        className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50/60 px-3 py-1.5 dark:border-amber-500/30 dark:bg-slate-950"
                      >
                        <span className="font-mono text-xs font-semibold text-amber-800 dark:text-amber-300">{u}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

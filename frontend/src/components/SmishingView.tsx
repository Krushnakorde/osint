import { useState, type FormEvent } from 'react';
import { useI18n } from '../I18n.tsx';
import { analyzeMessageApi } from '../api.ts';
import type { SmishingAnalysis } from '../types.ts';

interface Props {
  onInvestigate: (q: string) => void;
}

const SAMPLE_MESSAGES = [
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
  const [result, setResult] = useState<SmishingAnalysis | null>(null);

  const handleAnalyze = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (!text.trim()) return;
    setLoading(true);
    try {
      const res = await analyzeMessageApi(text, sender || undefined);
      setResult(res);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const loadSample = (sample: typeof SAMPLE_MESSAGES[0]) => {
    setText(sample.text);
    setSender(sample.sender);
    setResult(null);
  };

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      {/* Title */}
      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
          💬 {t('smish.title')}
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          {t('smish.subtitle')}
        </p>
      </div>

      {/* Samples */}
      <div className="mb-5">
        <div className="mb-2 text-xs font-medium text-slate-400">
          {t('smish.samples')}:
        </div>
        <div className="flex flex-wrap gap-2">
          {SAMPLE_MESSAGES.map((s, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => loadSample(s)}
              className="rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-1.5 text-xs text-slate-300 transition hover:border-cyan-500/50 hover:bg-cyan-950/30 hover:text-white"
            >
              {s.title}
            </button>
          ))}
        </div>
      </div>

      {/* Input Form */}
      <form onSubmit={handleAnalyze} className="mb-8 space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4 sm:p-5 backdrop-blur">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-300">
            {t('smish.placeholder')}
          </label>
          <textarea
            rows={4}
            required
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Dear customer, your account will be suspended. Verify here: https://phish-link.com or call +91..."
            className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-slate-100 placeholder-slate-500 transition focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[260px] flex-1">
            <input
              type="text"
              value={sender}
              onChange={(e) => setSender(e.target.value)}
              placeholder={t('smish.sender_placeholder')}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !text.trim()}
            className="rounded-lg bg-cyan-600 px-5 py-2 text-xs font-semibold text-white shadow-lg shadow-cyan-900/30 transition hover:bg-cyan-500 disabled:opacity-50"
          >
            {loading ? 'Analyzing…' : t('smish.button')}
          </button>
        </div>
      </form>

      {/* Analysis Results */}
      {result && (
        <div className="space-y-6">
          {/* Main Verdict Card */}
          <div
            className={`rounded-xl border p-5 shadow-xl backdrop-blur ${
              result.isSmishing
                ? 'border-rose-500/50 bg-rose-950/20'
                : result.riskScore >= 30
                ? 'border-amber-500/50 bg-amber-950/20'
                : 'border-emerald-500/50 bg-emerald-950/20'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{result.isSmishing ? '⚠️' : '✓'}</span>
                  <h3 className="text-lg font-bold text-white">
                    {result.isSmishing ? 'Likely Smishing / Fraud Message' : 'Low Suspicion Detected'}
                  </h3>
                </div>
                <p className="mt-1 text-xs text-slate-300">
                  {result.senderHeader.note}
                </p>
              </div>

              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                    {t('smish.score')}
                  </div>
                  <div
                    className={`text-2xl font-bold ${
                      result.riskScore >= 60
                        ? 'text-rose-400'
                        : result.riskScore >= 30
                        ? 'text-amber-400'
                        : 'text-emerald-400'
                    }`}
                  >
                    {result.riskScore} <span className="text-xs font-normal text-slate-400">/ 100</span>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-center">
                  <div className="text-[10px] text-slate-400">{t('smish.urgency')}</div>
                  <div className="text-xs font-bold uppercase text-white">{result.urgencyLevel}</div>
                </div>
              </div>
            </div>

            {/* Reasons List */}
            <div className="mt-4 border-t border-slate-800/80 pt-3">
              <div className="mb-1.5 text-xs font-semibold text-slate-200">Persuasion Signals & Analysis:</div>
              <ul className="space-y-1 text-xs text-slate-300">
                {result.reasons.map((r, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="text-cyan-400">•</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Extracted Indicators Section */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
            <h4 className="mb-4 text-sm font-semibold text-white">
              🔍 {t('smish.extracted')} (Pivots for Investigation)
            </h4>

            <div className="space-y-4">
              {/* Extracted Domains */}
              <div>
                <div className="mb-2 text-xs font-medium text-slate-400">
                  Phishing Links & Websites ({result.extracted.domains.length}):
                </div>
                {result.extracted.domains.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">No web links detected in message.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {result.extracted.domains.map((d) => (
                      <div
                        key={d}
                        className="flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-slate-950 px-3 py-1.5"
                      >
                        <span className="font-mono text-xs font-semibold text-cyan-300">{d}</span>
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
                <div className="mb-2 text-xs font-medium text-slate-400">
                  Phone Numbers ({result.extracted.phones.length}):
                </div>
                {result.extracted.phones.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">No phone numbers extracted.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {result.extracted.phones.map((p) => (
                      <div
                        key={p}
                        className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-slate-950 px-3 py-1.5"
                      >
                        <span className="font-mono text-xs font-semibold text-emerald-300">{p}</span>
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
                  <div className="mb-2 text-xs font-medium text-slate-400">
                    Email Addresses ({result.extracted.emails.length}):
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {result.extracted.emails.map((em) => (
                      <div
                        key={em}
                        className="flex items-center gap-2 rounded-lg border border-sky-500/30 bg-slate-950 px-3 py-1.5"
                      >
                        <span className="font-mono text-xs font-semibold text-sky-300">{em}</span>
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
                  <div className="mb-2 text-xs font-medium text-slate-400">
                    UPI Payment Handles ({result.extracted.upi.length}):
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {result.extracted.upi.map((u) => (
                      <div
                        key={u}
                        className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-slate-950 px-3 py-1.5"
                      >
                        <span className="font-mono text-xs font-semibold text-amber-300">{u}</span>
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

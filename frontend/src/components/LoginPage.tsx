import { useState, type FormEvent } from 'react';
import { useI18n } from '../I18n.tsx';
import { login, register, setAuthToken, type User } from '../api.ts';

interface Props {
  onLogin: (user: User) => void;
}

export default function LoginPage({ onLogin }: Props) {
  const { t, lang, setLang } = useI18n();
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (tab === 'login') {
        const res = await login(email.trim(), password);
        if (res.status === 200 && res.body?.token && res.body?.user) {
          setAuthToken(res.body.token);
          onLogin(res.body.user);
        } else {
          const msg = (res.body as { error?: string })?.error || 'Invalid email or password.';
          setError(msg);
        }
      } else {
        if (!name.trim()) {
          setError('Please enter your full name.');
          setLoading(false);
          return;
        }
        if (password.length < 8) {
          setError('Password must be at least 8 characters.');
          setLoading(false);
          return;
        }
        const res = await register(email.trim(), password, name.trim());
        if (res.status === 201 && res.body?.token && res.body?.user) {
          setAuthToken(res.body.token);
          onLogin(res.body.user);
        } else {
          const msg = (res.body as { error?: string })?.error || 'Registration failed. User may already exist.';
          setError(msg);
        }
      }
    } catch {
      setError(t('err.offline'));
    } finally {
      setLoading(false);
    }
  };

  const handleQuickAdmin = async () => {
    setError(null);
    setLoading(true);
    setEmail('admin@example.com');
    setPassword('Pass@123');
    try {
      const res = await login('admin@example.com', 'Pass@123');
      if (res.status === 200 && res.body?.token && res.body?.user) {
        setAuthToken(res.body.token);
        onLogin(res.body.user);
      } else {
        setError('Admin account login failed. Check database seed.');
      }
    } catch {
      setError(t('err.offline'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 py-12 text-slate-100 sm:px-6 lg:px-8">
      {/* Background ambient glow */}
      <div className="pointer-events-none fixed inset-0 flex items-center justify-center overflow-hidden">
        <div className="h-[500px] w-[500px] rounded-full bg-cyan-600/10 blur-[120px]" />
        <div className="h-[400px] w-[400px] rounded-full bg-blue-600/10 blur-[100px]" />
      </div>

      {/* Top right language switch */}
      <div className="absolute right-4 top-4 z-10 flex overflow-hidden rounded-lg border border-slate-800 bg-slate-900/80 text-xs backdrop-blur">
        {(['en', 'mr'] as const).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLang(l)}
            className={`px-3 py-1.5 font-medium transition ${
              lang === l ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {l === 'en' ? 'English' : 'मराठी'}
          </button>
        ))}
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Header Branding */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-500/30 bg-cyan-950/40 text-3xl shadow-lg shadow-cyan-950/50">
            🛡️
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            {t('app.title')}
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            {t('app.tagline')}
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl shadow-black/80 backdrop-blur-xl sm:p-8">
          {/* Tabs */}
          <div className="mb-6 grid grid-cols-2 rounded-xl border border-slate-800 bg-slate-950/60 p-1">
            <button
              type="button"
              onClick={() => { setTab('login'); setError(null); }}
              className={`rounded-lg py-2 text-sm font-semibold transition ${
                tab === 'login'
                  ? 'bg-cyan-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t('auth.login')}
            </button>
            <button
              type="button"
              onClick={() => { setTab('register'); setError(null); }}
              className={`rounded-lg py-2 text-sm font-semibold transition ${
                tab === 'register'
                  ? 'bg-cyan-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t('auth.register')}
            </button>
          </div>

          {error && (
            <div className="mb-5 rounded-lg border border-red-500/30 bg-red-950/40 p-3 text-xs text-red-200">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {tab === 'register' && (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-300">
                  {t('auth.name')}
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Detective Inspector"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white placeholder-slate-500 transition focus:border-cyan-500 focus:outline-none"
                />
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">
                {t('auth.email')}
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="investigator@agency.gov"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white placeholder-slate-500 transition focus:border-cyan-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">
                {t('auth.password')}
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white placeholder-slate-500 transition focus:border-cyan-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 w-full rounded-lg bg-cyan-600 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-900/30 transition hover:bg-cyan-500 disabled:opacity-50"
            >
              {loading ? t('auth.submitting') : tab === 'login' ? t('auth.login') : t('auth.register')}
            </button>
          </form>

          {/* Quick Admin Access */}
          <div className="mt-6 border-t border-slate-800/80 pt-5">
            <button
              type="button"
              disabled={loading}
              onClick={handleQuickAdmin}
              className="group flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-950/20 px-4 py-2 text-xs font-medium text-cyan-300 transition hover:border-cyan-500/60 hover:bg-cyan-950/40"
            >
              <span>⚡</span>
              <span>Quick Admin Access (admin@example.com)</span>
            </button>
            <p className="mt-2 text-center text-[11px] text-slate-500">
              Pre-configured admin credentials for quick evaluation
            </p>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          Strict Zero-Trust Authentication &bull; MongoDB Backed
        </p>
      </div>
    </div>
  );
}

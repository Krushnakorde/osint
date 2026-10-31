import { useState, type FormEvent } from 'react';
import { useI18n } from '../I18n.tsx';
import { login, register, type User } from '../api.ts';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (user: User) => void;
}

export default function AuthModal({ isOpen, onClose, onSuccess }: Props) {
  const { t } = useI18n();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!isOpen) return null;

  const handleDemo = async () => {
    setBusy(true);
    setError(null);
    try {
      // Try login first
      let res = await login('demo@investigator.local', 'DemoInvestigator123!');
      if (res.status === 200 && res.body.user) {
        onSuccess(res.body.user);
        onClose();
        return;
      }
      // If failed, register
      res = await register('demo@investigator.local', 'DemoInvestigator123!', 'Demo Investigator');
      if (res.status === 201 && res.body.user) {
        onSuccess(res.body.user);
        onClose();
        return;
      }
      setError('Could not complete demo login.');
    } catch {
      setError('Connection failed. Please check backend.');
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (isRegister) {
        if (!name.trim()) {
          setError(t('auth.name'));
          setBusy(false);
          return;
        }
        const res = await register(email, password, name);
        if (res.status === 201 && res.body.user) {
          onSuccess(res.body.user);
          onClose();
        } else {
          setError((res.body as { message?: string }).message || 'Registration failed.');
        }
      } else {
        const res = await login(email, password);
        if (res.status === 200 && res.body.user) {
          onSuccess(res.body.user);
          onClose();
        } else {
          setError((res.body as { message?: string }).message || 'Login failed.');
        }
      }
    } catch {
      setError('Request failed. Is the backend running?');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex gap-4">
            <button
              onClick={() => { setIsRegister(false); setError(null); }}
              className={`pb-1 text-base font-semibold transition ${!isRegister ? 'border-b-2 border-cyan-500 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {t('auth.login')}
            </button>
            <button
              onClick={() => { setIsRegister(true); setError(null); }}
              className={`pb-1 text-base font-semibold transition ${isRegister ? 'border-b-2 border-cyan-500 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {t('auth.register')}
            </button>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white">✕</button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-950/60 p-3 text-sm text-red-200 border border-red-800">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {isRegister && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">{t('auth.name')}</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Agent Smith"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
              />
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">{t('auth.email')}</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="investigator@agency.gov"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">{t('auth.password')}</label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-cyan-600 py-2.5 font-medium text-white transition hover:bg-cyan-500 disabled:opacity-50"
          >
            {busy ? t('auth.submitting') : isRegister ? t('auth.register') : t('auth.login')}
          </button>
        </form>

        <div className="relative my-5 flex items-center justify-center">
          <div className="w-full border-t border-slate-800"></div>
          <span className="absolute bg-slate-900 px-3 text-xs text-slate-500">OR</span>
        </div>

        <button
          type="button"
          onClick={handleDemo}
          disabled={busy}
          className="w-full rounded-lg border border-cyan-800/60 bg-cyan-950/30 py-2.5 text-sm font-medium text-cyan-300 transition hover:bg-cyan-900/40 disabled:opacity-50"
        >
          ⚡ {t('auth.demo')}
        </button>
      </div>
    </div>
  );
}

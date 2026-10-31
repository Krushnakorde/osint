import { useState, type FormEvent } from 'react';
import { useI18n } from '../I18n.tsx';
import type { User } from '../api.ts';

export type NavTab = 'investigate' | 'smishing' | 'history' | 'analytics' | 'admin';

interface Props {
  onSearch: (q: string) => void;
  busy: boolean;
  initial?: string;
  user: User;
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  onLogout: () => void;
}

export default function Header({
  onSearch,
  busy,
  initial = '',
  user,
  activeTab,
  onTabChange,
  onLogout,
}: Props) {
  const { t, lang, setLang } = useI18n();
  const [q, setQ] = useState(initial);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (q.trim()) {
      onTabChange('investigate');
      onSearch(q.trim());
    }
  };

  const tabs: Array<{ id: NavTab; label: string; icon: string; adminOnly?: boolean }> = [
    { id: 'investigate', label: t('nav.investigate'), icon: '🔍' },
    { id: 'smishing', label: t('nav.smishing'), icon: '💬' },
    { id: 'history', label: t('nav.history'), icon: '📜' },
    { id: 'analytics', label: t('nav.analytics'), icon: '📊' },
    { id: 'admin', label: t('nav.admin'), icon: '⚙️', adminOnly: true },
  ];

  return (
    <header className="border-b border-slate-800 bg-slate-900/80 px-4 py-3 backdrop-blur sm:px-6 sticky top-0 z-30">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
        {/* Brand & Navigation */}
        <div className="flex flex-wrap items-center gap-4 sm:gap-6">
          <div
            onClick={() => onTabChange('investigate')}
            className="flex cursor-pointer items-center gap-2 font-bold tracking-tight text-white hover:text-cyan-400 transition"
          >
            <span className="text-xl">🛡️</span>
            <span className="text-base sm:text-lg">{t('app.title')}</span>
          </div>

          <nav className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-950/60 p-1">
            {tabs
              .filter((tab) => !tab.adminOnly || user.role === 'admin')
              .map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => onTabChange(tab.id)}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      isActive
                        ? 'bg-cyan-600 text-white shadow-sm shadow-cyan-900/40'
                        : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                    }`}
                  >
                    <span>{tab.icon}</span>
                    <span>{tab.label}</span>
                  </button>
                );
              })}
          </nav>
        </div>

        {/* Global Search Bar */}
        <form onSubmit={submit} className="order-3 flex w-full gap-2 sm:order-none sm:w-auto sm:max-w-md sm:flex-1">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('search.placeholder')}
            aria-label={t('search.placeholder')}
            className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-1.5 text-xs text-slate-100 placeholder-slate-500 transition focus:border-cyan-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-cyan-600 px-4 py-1.5 text-xs font-semibold text-white shadow transition hover:bg-cyan-500 disabled:opacity-50"
          >
            {busy ? t('search.busy') : t('search.button')}
          </button>
        </form>

        {/* Right side controls: User badge, Language, Logout */}
        <div className="flex items-center gap-3">
          {/* User profile chip */}
          <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-1 text-xs">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-[11px]">
              {user.role === 'admin' ? '🛡️' : '👤'}
            </span>
            <div className="hidden sm:block">
              <span className="font-medium text-slate-200">{user.name}</span>
              <span className="ml-1.5 rounded bg-slate-800/80 px-1.5 py-0.2 text-[10px] text-cyan-300 capitalize font-mono">
                {user.role}
              </span>
            </div>
          </div>

          {/* Language Switch */}
          <div
            role="group"
            aria-label={t('lang.label')}
            className="flex overflow-hidden rounded-lg border border-slate-800 text-xs"
          >
            {(['en', 'mr'] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                className={`px-2.5 py-1 font-medium transition ${
                  lang === l
                    ? 'bg-cyan-600 text-white'
                    : 'bg-slate-950 text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                }`}
              >
                {l === 'en' ? 'EN' : 'मराठी'}
              </button>
            ))}
          </div>

          {/* Logout button */}
          <button
            type="button"
            onClick={onLogout}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1 text-xs font-medium text-slate-300 transition hover:border-red-500/50 hover:bg-red-950/20 hover:text-red-200"
          >
            {t('auth.logout')}
          </button>
        </div>
      </div>
    </header>
  );
}

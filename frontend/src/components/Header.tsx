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
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof localStorage !== 'undefined') {
      return (localStorage.getItem('osint_theme') as 'light' | 'dark') || 'light';
    }
    return 'light';
  });

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('osint_theme', next);
    }
    if (next === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

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
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur shadow-sm dark:border-slate-800 dark:bg-slate-900/90 sm:px-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-2.5">
        {/* Top Bar: Brand (Left) & Controls with Logout pinned to Top Right Corner */}
        <div className="flex items-center justify-between gap-3">
          {/* Brand Logo / Title */}
          <div
            onClick={() => onTabChange('investigate')}
            className="flex cursor-pointer items-center gap-2 font-bold tracking-tight text-slate-900 transition hover:text-cyan-600 dark:text-white dark:hover:text-cyan-400"
          >
            <span className="text-xl">🛡️</span>
            <span className="text-base sm:text-lg">{t('app.title')}</span>
          </div>

          {/* Top Right Corner Controls: Profile, Theme, Language, and Logout */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* User profile chip */}
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs dark:border-slate-800 dark:bg-slate-950/70">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[11px] dark:bg-slate-800">
                {user.role === 'admin' ? '🛡️' : '👤'}
              </span>
              <div className="hidden md:block">
                <span className="font-medium text-slate-800 dark:text-slate-200">{user.name}</span>
                <span className="ml-1.5 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-mono capitalize text-cyan-700 dark:bg-slate-800 dark:text-cyan-300">
                  {user.role}
                </span>
              </div>
            </div>

            {/* Theme Switcher */}
            <button
              type="button"
              onClick={toggleTheme}
              title={t('theme.toggle')}
              className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:border-cyan-500 hover:text-cyan-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-cyan-500 dark:hover:text-white"
            >
              <span>{theme === 'light' ? '☀️' : '🌙'}</span>
              <span className="hidden sm:inline">{theme === 'light' ? 'Light' : 'Dark'}</span>
            </button>

            {/* Language Switch */}
            <div
              role="group"
              aria-label={t('lang.label')}
              className="flex overflow-hidden rounded-lg border border-slate-200 text-xs dark:border-slate-800"
            >
              {(['en', 'mr'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLang(l)}
                  className={`px-2.5 py-1.5 font-medium transition ${
                    lang === l
                      ? 'bg-cyan-600 text-white'
                      : 'bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-950 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {l === 'en' ? 'EN' : 'मराठी'}
                </button>
              ))}
            </div>

            {/* Logout button (Anchored firmly in Top Right Corner) */}
            <button
              type="button"
              onClick={onLogout}
              title={t('auth.logout')}
              className="flex items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 shadow-sm transition hover:border-rose-400 hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:border-rose-700 dark:hover:bg-rose-900/60"
            >
              <span>🚪</span>
              <span>{t('auth.logout')}</span>
            </button>
          </div>
        </div>

        {/* Bottom Bar: Navigation Tabs (Left) & Global Search Input (Right) */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-2.5 dark:border-slate-800/80">
          {/* Navigation Tabs */}
          <nav className="flex items-center gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-950/60">
            {tabs
              .filter((tab) => !tab.adminOnly || user.role === 'admin')
              .map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => onTabChange(tab.id)}
                    className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      isActive
                        ? 'bg-cyan-600 text-white shadow-sm shadow-cyan-900/40'
                        : 'text-slate-600 hover:bg-white hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    <span>{tab.icon}</span>
                    <span>{tab.label}</span>
                  </button>
                );
              })}
          </nav>

          {/* Global Search Bar */}
          <form onSubmit={submit} className="flex min-w-[240px] flex-1 sm:max-w-md gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('search.placeholder')}
              aria-label={t('search.placeholder')}
              className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs text-slate-900 placeholder-slate-400 transition focus:border-cyan-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder-slate-500"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-cyan-600 px-4 py-1.5 text-xs font-semibold text-white shadow transition hover:bg-cyan-500 disabled:opacity-50"
            >
              {busy ? t('search.busy') : t('search.button')}
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}

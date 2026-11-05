/**
 * ============================================================================
 * MODULE: Root Application Component & Dashboard Router
 * FILE: frontend/src/App.tsx
 * ============================================================================
 *
 * WHAT THIS FILE DOES:
 * -------------------
 * This is the root React component of the OSINT Fraud Intelligence Dashboard.
 * It manages:
 * 1. Global Application State:
 *    - User authentication session (JWT).
 *    - Active investigation query results and graph data.
 *    - Selected graph node for inspector drill-down.
 *    - Navigation tab state ('investigate', 'smishing', 'history', 'analytics', 'admin').
 *    - Error handling, suggestions, and loading spinners.
 *
 * 2. Strict Authentication Guard:
 *    - If unauthenticated, it renders `LoginPage` exclusively.
 *    - When authenticated, it unlocks the intelligence dashboard and navigation tabs.
 *
 * 3. Master Layout Orchestration:
 *    - Two-column responsive desktop layout: Left panel holds forensic verdict cards
 *      and change vectors; right panel hosts the interactive D3/SVG Force-Directed Graph.
 *
 * 4. Multilingual Context (i18n):
 *    - Wraps the entire tree in `I18nProvider` supporting seamless English and Marathi
 *      localization without reloading.
 * ============================================================================
 */

import { useEffect, useState } from 'react';
import Header, { type NavTab } from './components/Header.tsx';
import Home from './components/Home.tsx';
import LiveStatus from './components/LiveStatus.tsx';
import VerdictCard from './components/VerdictCard.tsx';
import FactsCard from './components/FactsCard.tsx';
import Connections from './components/Connections.tsx';
import GraphView from './components/GraphView.tsx';
import NodeDetails from './components/NodeDetails.tsx';
import TechnicalDetails from './components/TechnicalDetails.tsx';
import ChangeVectorCard from './components/ChangeVectorCard.tsx';
import SmishingView from './components/SmishingView.tsx';
import LoginPage from './components/LoginPage.tsx';
import HistoryView from './components/HistoryView.tsx';
import AnalyticsView from './components/AnalyticsView.tsx';
import AdminView from './components/AdminView.tsx';
import { I18nProvider, useI18n } from './I18n.tsx';
import { search, getRecent, logout, ensureSession, type User } from './api.ts';
import type { GraphNode, Investigation, LiveSummary, MessageCode, RecentItem } from './types.ts';

/** Error state structure for user-facing alert banners */
interface ErrorState {
  key: string;
  hints: string[];
}

/** Error translation key mapping for standard backend error codes */
const ERROR_KEY: Record<MessageCode, string> = {
  unrecognised: 'err.unrecognised',
  offline: 'err.offlineMode',
  unreachable: 'err.unreachable',
  nodata: 'err.nodata',
};

/**
 * Main dashboard container managing session state, queries, and layout.
 */
function Dashboard() {
  const { t } = useI18n();

  // Authentication & session state
  const [user, setUser] = useState<User | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  // Tab navigation state ('investigate' | 'smishing' | 'history' | 'analytics' | 'admin')
  const [activeTab, setActiveTab] = useState<NavTab>('investigate');

  // Investigation results & graph selection state
  const [result, setResult] = useState<Investigation | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [error, setError] = useState<ErrorState | null>(null);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [live, setLive] = useState<LiveSummary | undefined>(undefined);
  const [query, setQuery] = useState('');

  /** Loads recently observed threat indicators for the home screen feed */
  const loadRecent = () => {
    getRecent().then((r) => setRecent(Array.isArray(r) ? r : [])).catch(() => {});
  };

  /** On mount: verify if an existing JWT token in LocalStorage is still valid */
  useEffect(() => {
    const savedTheme = localStorage.getItem('osint_theme') || 'light';
    if (savedTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    ensureSession()
      .then((u) => {
        if (u) {
          setUser(u);
          loadRecent();
        }
      })
      .catch(() => {})
      .finally(() => {
        setSessionLoading(false);
      });
  }, []);

  /** Terminates user session and resets application state */
  const handleLogout = async () => {
    await logout();
    setUser(null);
    setRecent([]);
    setResult(null);
    setActiveTab('investigate');
  };

  /**
   * Executes an investigation search across graph intelligence.
   *
   * @param q The target indicator (e.g. domain, phone, crypto wallet, IP, APK hash).
   */
  const run = async (q: string): Promise<void> => {
    setBusy(true);
    setError(null);
    setSelected(null);
    setLive(undefined);
    setQuery(q);
    setActiveTab('investigate');

    try {
      const { status, body } = await search(q);

      // Handle session expiration
      if (status === 401) {
        setUser(null);
        setError({ key: 'err.unauthenticated', hints: [] });
        return;
      }

      // Handle successful query match
      if ('found' in body && body.found) {
        setResult(body);
        setLive(body.live);
      } else {
        // Handle unobserved indicator (returns suggestions if typos exist)
        setResult(null);
        const nf = 'found' in body ? body : null;
        setLive(nf?.live);
        setError({
          key: ERROR_KEY[nf?.messageCode ?? 'nodata'],
          hints: nf?.suggestions?.map((s) => s.value) ?? [],
        });
      }
    } catch {
      setError({ key: 'err.offline', hints: [] });
    } finally {
      setBusy(false);
    }
  };

  // --------------------------------------------------------------------------
  // RENDER STEP 1: Initial Loading Spinner (while checking JWT token validity)
  // --------------------------------------------------------------------------
  if (sessionLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
          <p className="text-xs uppercase tracking-wider">Verifying session…</p>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // RENDER STEP 2: Authentication Gate (unauthenticated users see login screen)
  // --------------------------------------------------------------------------
  if (!user) {
    return (
      <LoginPage
        onLogin={(u) => {
          setUser(u);
          loadRecent();
        }}
      />
    );
  }

  // --------------------------------------------------------------------------
  // RENDER STEP 3: Authenticated Main Application Experience
  // --------------------------------------------------------------------------
  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      {/* Top Navigation Bar with Search Box, Language Switcher, and User Menu */}
      <Header
        key={query}
        onSearch={(q) => { void run(q); }}
        busy={busy}
        initial={query}
        user={user}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onLogout={() => { void handleLogout(); }}
      />

      {/* TAB 1: Main OSINT Investigation View */}
      {activeTab === 'investigate' && (
        <>
          {busy && (
            <p className="bg-cyan-950/60 px-6 py-2 text-center text-xs text-cyan-200">
              {t('search.waiting')}
            </p>
          )}

          {/* Live passive enrichment status bar */}
          <LiveStatus live={live} />

          {/* User notification / error banner */}
          {error && (
            <p className="bg-red-950/50 px-6 py-3 text-center text-xs text-red-200">
              {t(error.key)}
              {error.hints.length > 0 && <> {t('err.didyoumean')} {error.hints.join(', ')}</>}
            </p>
          )}

          {result ? (
            /* Split Dashboard: Forensic Cards (Left) + Interactive Graph (Right) */
            <main className="mx-auto grid w-full max-w-7xl flex-1 gap-4 p-4 lg:grid-cols-[26rem_1fr]">
              <div className="space-y-4 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-1">
                {/* Forensic verdict card with explainability bullet points */}
                <VerdictCard
                  value={result.query.value}
                  typeKey={`type.${result.query.type}`}
                  assessment={result.assessment}
                />
                {/* Temporal change vector tracking infrastructure churn */}
                <ChangeVectorCard changeVector={result.changeVector} />
                {/* Raw technical facts (registrations, IPs, certificates) */}
                <FactsCard facts={result.facts} />
                {/* Node details drawer when clicking graph vertices */}
                <NodeDetails
                  node={selected}
                  assets={result.assets}
                  onCheck={(v) => { void run(v); }}
                />
                {/* Pairwise bipartite connections and shared infrastructure */}
                <Connections
                  assets={result.assets}
                  evidence={result.evidence}
                  queryId={result.query.id}
                  onPick={(v) => { void run(v); }}
                />
                {/* Raw JSON technical export */}
                <TechnicalDetails result={result} />
              </div>

              {/* D3 Canvas: Force-Directed Bipartite Threat Map */}
              <div className="min-h-[420px] lg:h-[calc(100vh-7rem)]">
                <GraphView
                  graph={result.graph}
                  assets={result.assets}
                  truncated={result.truncated}
                  onSelect={setSelected}
                />
              </div>
            </main>
          ) : (
            /* Empty state: Home landing screen with recent threat indicators */
            <main className="flex-1">
              <Home recent={recent} onPick={(q) => { void run(q); }} />
            </main>
          )}
        </>
      )}

      {/* TAB 2: Smishing / SMS Phishing Analyzer */}
      {activeTab === 'smishing' && (
        <main className="flex-1">
          <SmishingView onInvestigate={(q) => { void run(q); }} />
        </main>
      )}

      {/* TAB 3: User Investigation History */}
      {activeTab === 'history' && (
        <main className="flex-1">
          <HistoryView onSelectQuery={(q) => { void run(q); }} />
        </main>
      )}

      {/* TAB 4: Investigation Analytics & Threat Visualizations */}
      {activeTab === 'analytics' && (
        <main className="flex-1">
          <AnalyticsView user={user} />
        </main>
      )}

      {/* TAB 5: Administrator Controls (Model Retraining, Feed Sync, Syndicate Correlation) */}
      {activeTab === 'admin' && user.role === 'admin' && (
        <main className="flex-1">
          <AdminView />
        </main>
      )}
    </div>
  );
}

/**
 * Root Application Export wrapped with internationalization (i18n) context provider.
 */
export default function App() {
  return (
    <I18nProvider>
      <Dashboard />
    </I18nProvider>
  );
}

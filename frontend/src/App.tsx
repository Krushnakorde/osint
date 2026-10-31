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

interface ErrorState { key: string; hints: string[] }
const ERROR_KEY: Record<MessageCode, string> = {
  unrecognised: 'err.unrecognised',
  offline: 'err.offlineMode',
  unreachable: 'err.unreachable',
  nodata: 'err.nodata',
};

function Dashboard() {
  const { t } = useI18n();
  const [user, setUser] = useState<User | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<NavTab>('investigate');

  const [result, setResult] = useState<Investigation | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [error, setError] = useState<ErrorState | null>(null);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [live, setLive] = useState<LiveSummary | undefined>(undefined);
  const [query, setQuery] = useState('');

  const loadRecent = () => {
    getRecent().then((r) => setRecent(Array.isArray(r) ? r : [])).catch(() => {});
  };

  useEffect(() => {
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

  const handleLogout = async () => {
    await logout();
    setUser(null);
    setRecent([]);
    setResult(null);
    setActiveTab('investigate');
  };

  const run = async (q: string): Promise<void> => {
    setBusy(true);
    setError(null);
    setSelected(null);
    setLive(undefined);
    setQuery(q);
    setActiveTab('investigate');

    try {
      const { status, body } = await search(q);
      if (status === 401) {
        setUser(null);
        setError({ key: 'err.unauthenticated', hints: [] });
        return;
      }
      if ('found' in body && body.found) {
        setResult(body);
        setLive(body.live);
      } else {
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

  // 1. Initial Loading Screen
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

  // 2. Strict Authentication Gate: if not logged in, render LoginPage only!
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

  // 3. Authenticated App Experience
  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
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

      {activeTab === 'investigate' && (
        <>
          {busy && (
            <p className="bg-cyan-950/60 px-6 py-2 text-center text-xs text-cyan-200">
              {t('search.waiting')}
            </p>
          )}
          <LiveStatus live={live} />
          {error && (
            <p className="bg-red-950/50 px-6 py-3 text-center text-xs text-red-200">
              {t(error.key)}
              {error.hints.length > 0 && <> {t('err.didyoumean')} {error.hints.join(', ')}</>}
            </p>
          )}
          {result ? (
            <main className="mx-auto grid w-full max-w-7xl flex-1 gap-4 p-4 lg:grid-cols-[26rem_1fr]">
              <div className="space-y-4 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-1">
                <VerdictCard
                  value={result.query.value}
                  typeKey={`type.${result.query.type}`}
                  assessment={result.assessment}
                />
                <ChangeVectorCard changeVector={result.changeVector} />
                <FactsCard facts={result.facts} />
                <NodeDetails
                  node={selected}
                  assets={result.assets}
                  onCheck={(v) => { void run(v); }}
                />
                <Connections
                  assets={result.assets}
                  evidence={result.evidence}
                  queryId={result.query.id}
                  onPick={(v) => { void run(v); }}
                />
                <TechnicalDetails result={result} />
              </div>
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
            <main className="flex-1">
              <Home recent={recent} onPick={(q) => { void run(q); }} />
            </main>
          )}
        </>
      )}

      {activeTab === 'smishing' && (
        <main className="flex-1">
          <SmishingView onInvestigate={(q) => { void run(q); }} />
        </main>
      )}

      {activeTab === 'history' && (
        <main className="flex-1">
          <HistoryView onSelectQuery={(q) => { void run(q); }} />
        </main>
      )}

      {activeTab === 'analytics' && (
        <main className="flex-1">
          <AnalyticsView user={user} />
        </main>
      )}

      {activeTab === 'admin' && user.role === 'admin' && (
        <main className="flex-1">
          <AdminView />
        </main>
      )}
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <Dashboard />
    </I18nProvider>
  );
}

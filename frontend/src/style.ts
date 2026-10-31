import type { Level, NodeType } from './types.ts';

export interface LevelStyle { badge: string; border: string; text: string; ring: string; icon: string }
export const LEVEL_STYLE: Record<Level, LevelStyle> = {
  official:   { badge: 'bg-sky-500/15 text-sky-300 border-sky-500/40',         border: 'border-sky-500/50',    text: 'text-sky-300',    ring: '#38bdf8', icon: '✓' },
  high:       { badge: 'bg-red-500/15 text-red-300 border-red-500/40',         border: 'border-red-500/60',    text: 'text-red-300',    ring: '#ef4444', icon: '⚠' },
  suspicious: { badge: 'bg-orange-500/15 text-orange-300 border-orange-500/40', border: 'border-orange-500/60', text: 'text-orange-300', ring: '#f97316', icon: '!' },
  signals:    { badge: 'bg-yellow-500/15 text-yellow-200 border-yellow-500/40', border: 'border-yellow-500/50', text: 'text-yellow-200', ring: '#eab308', icon: '!' },
  none:       { badge: 'bg-slate-500/15 text-slate-300 border-slate-500/40',   border: 'border-slate-600',     text: 'text-slate-300',  ring: '#64748b', icon: 'i' },
  info:       { badge: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40', border: 'border-indigo-500/50', text: 'text-indigo-300', ring: '#818cf8', icon: 'i' },
};

export const TYPE_COLORS: Record<NodeType, string> = {
  domain: '#22d3ee', wallet: '#fbbf24', apk: '#a78bfa', ip: '#94a3b8', cert: '#34d399', signer: '#f472b6',
  tracker: '#fb923c', package: '#c084fc', nameserver: '#64748b', registrar: '#78716c', brand: '#f87171', asn: '#475569',
  report: '#facc15', blocklist: '#ef4444', email: '#38bdf8', phone: '#4ade80',
};
export const ASSET_TYPES: ReadonlySet<string> = new Set(['domain', 'wallet', 'apk', 'email', 'phone']);

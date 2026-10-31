// Pure analytics over search events: used by the in-memory adapter and by the insight generator.
import type { DayCount, Scope, SearchEvent, Slice, TopQuery, TopUser, Totals } from '../application/ports.ts';

export interface Insight { code: 'no_data' | 'top_query' | 'trend' | 'flagged_share' | 'peak_hour' | 'spike' | 'live_share'; params: Record<string, string | number> }

export const inScope = (e: SearchEvent, s: Scope): boolean =>
  (s.userId === undefined || e.userId === s.userId) && (s.since === undefined || Date.parse(e.createdAt) >= s.since.getTime());

export function totals(events: SearchEvent[]): Totals {
  const n = events.length;
  return {
    searches: n, users: new Set(events.map((e) => e.userId)).size,
    flagged: events.filter((e) => e.level === 'high' || e.level === 'suspicious').length,
    live: events.filter((e) => e.live).length,
    avgLatencyMs: n ? Math.round(events.reduce((s, e) => s + e.latencyMs, 0) / n) : 0,
  };
}
const countBy = <T>(items: T[], key: (x: T) => string): Map<string, number> => {
  const m = new Map<string, number>(); for (const i of items) { const k = key(i); m.set(k, (m.get(k) ?? 0) + 1); } return m;
};
export function topQueries(events: SearchEvent[], limit: number): TopQuery[] {
  const m = new Map<string, TopQuery>();
  for (const e of events) { const k = `${e.kind}|${e.value}`; const cur = m.get(k); if (cur) cur.count++; else m.set(k, { value: e.value, kind: e.kind, count: 1 }); }
  return [...m.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)).slice(0, limit);
}
export const perDay = (events: SearchEvent[]): DayCount[] =>
  [...countBy(events, (e) => e.createdAt.slice(0, 10))].map(([day, count]) => ({ day, count })).sort((a, b) => a.day.localeCompare(b.day));
export const slices = (events: SearchEvent[], key: (e: SearchEvent) => string): Slice[] =>
  [...countBy(events, key)].map(([k, count]) => ({ key: k, count })).sort((a, b) => b.count - a.count);
export function heatmap(events: SearchEvent[]): number[][] {
  const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const e of events) { const d = new Date(e.createdAt); (grid[d.getUTCDay()] as number[])[d.getUTCHours()]!++; }
  return grid;
}
export const topUsers = (events: SearchEvent[], limit: number): TopUser[] =>
  [...countBy(events, (e) => e.userId)].map(([userId, count]) => ({ userId, count })).sort((a, b) => b.count - a.count).slice(0, limit);

/** The last `days` UTC calendar days (oldest first), zero-filled. */
export function fillDays(sparse: DayCount[], days: number, nowMs: number): DayCount[] {
  const have = new Map(sparse.map((d) => [d.day, d.count]));
  return Array.from({ length: days }, (_, i) => { const day = new Date(nowMs - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10); return { day, count: have.get(day) ?? 0 }; });
}

export interface InsightInput { current: DayCount[]; previous: DayCount[]; totals: Totals; topQueries: TopQuery[]; heatmap: number[][] }
/** Automatic, rule-based insights (statistics, not a language model). */
export function buildInsights(i: InsightInput): Insight[] {
  if (i.totals.searches === 0) return [{ code: 'no_data', params: {} }];
  const out: Insight[] = [];
  const top = i.topQueries[0];
  if (top) out.push({ code: 'top_query', params: { value: top.value, count: top.count } });
  const sum = (d: DayCount[]): number => d.reduce((s, x) => s + x.count, 0);
  const last = sum(i.current); const prev = sum(i.previous);
  if (last + prev >= 5) {
    const pct = prev > 0 ? Math.round(((last - prev) / prev) * 100) : 100;
    out.push({ code: 'trend', params: { pct: Math.abs(pct), dir: pct > 5 ? 'up' : pct < -5 ? 'down' : 'flat', days: i.current.length } });
  }
  out.push({ code: 'flagged_share', params: { pct: Math.round((i.totals.flagged / i.totals.searches) * 100) } });
  const byHour = new Array<number>(24).fill(0);
  for (const row of i.heatmap) row.forEach((c, h) => { byHour[h] = (byHour[h] as number) + c; });
  const peak = byHour.indexOf(Math.max(...byHour));
  if (byHour[peak]) out.push({ code: 'peak_hour', params: { hour: peak } });
  // spike: the busiest day compared with all the OTHER days (leave-one-out, so one outlier cannot hide itself)
  const maxDay = i.current.reduce((a, b) => (b.count > a.count ? b : a), i.current[0] as DayCount);
  const others = i.current.filter((d) => d !== maxDay).map((d) => d.count);
  if (others.length >= 3) {
    const mean = others.reduce((x, y) => x + y, 0) / others.length;
    const sd = Math.max(1, Math.sqrt(others.reduce((x, c) => x + (c - mean) ** 2, 0) / others.length));
    if (maxDay.count >= 5 && (maxDay.count - mean) / sd >= 3) out.push({ code: 'spike', params: { day: maxDay.day, count: maxDay.count } });
  }
  out.push({ code: 'live_share', params: { pct: Math.round((i.totals.live / i.totals.searches) * 100) } });
  return out;
}

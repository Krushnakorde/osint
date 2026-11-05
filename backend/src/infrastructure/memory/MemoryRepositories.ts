import crypto from 'node:crypto';
import * as A from '../../domain/analytics.ts';
import type {
  AnalyticsRepository, DayCount, ModelDoc, ModelRepository, NewSearchEvent, NewUser, RefreshTokenRecord,
  RefreshTokenRepository, RevokedTokenRepository, Scope, SearchEvent,
  SearchEventRepository, Slice, TopQuery, TopUser, Totals, UserRecord, UserRepository,
} from '../../application/ports.ts';

export class MemoryUserRepository implements UserRepository {
  private users = new Map<string, UserRecord>();
  async create(u: NewUser): Promise<UserRecord> {
    if ([...this.users.values()].some((x) => x.email === u.email)) throw new Error('duplicate email');
    const rec: UserRecord = { ...u, id: crypto.randomUUID(), tokenVersion: 1, createdAt: new Date().toISOString() };
    this.users.set(rec.id, rec); return { ...rec };
  }
  async findByEmail(email: string): Promise<UserRecord | null> { const u = [...this.users.values()].find((x) => x.email === email); return u ? { ...u } : null; }
  async findById(id: string): Promise<UserRecord | null> { const u = this.users.get(id); return u ? { ...u } : null; }
  async findByIds(ids: string[]): Promise<UserRecord[]> { return ids.flatMap((id) => { const u = this.users.get(id); return u ? [{ ...u }] : []; }); }
  async count(): Promise<number> { return this.users.size; }
  async touchLogin(id: string): Promise<void> { const u = this.users.get(id); if (u) u.lastLoginAt = new Date().toISOString(); }
  async updatePassword(id: string, newPasswordHash: string): Promise<void> {
    const u = this.users.get(id);
    if (u) u.passwordHash = newPasswordHash;
  }
  async incrementTokenVersion(id: string): Promise<number> {
    const u = this.users.get(id);
    if (!u) return 1;
    u.tokenVersion = (u.tokenVersion ?? 1) + 1;
    return u.tokenVersion;
  }
}

export class MemoryRevokedTokenRepository implements RevokedTokenRepository {
  private revoked = new Map<string, number>();
  async revoke(jti: string, expiresAt: Date): Promise<void> { this.revoked.set(jti, expiresAt.getTime()); }
  async isRevoked(jti: string): Promise<boolean> {
    const exp = this.revoked.get(jti);
    if (exp === undefined) return false;
    if (exp < Date.now()) { this.revoked.delete(jti); return false; } // an expired token is rejected anyway
    return true;
  }
}

export class MemoryRefreshTokenRepository implements RefreshTokenRepository {
  private tokens = new Map<string, RefreshTokenRecord>();

  async create(token: { id: string; userId: string; familyId: string; fingerprint: string; expiresAt: Date }): Promise<void> {
    this.tokens.set(token.id, {
      ...token,
      isUsed: false,
      isRevoked: false,
      createdAt: new Date().toISOString(),
    });
  }

  async findById(id: string): Promise<RefreshTokenRecord | null> {
    const t = this.tokens.get(id);
    return t ? { ...t } : null;
  }

  async markUsed(id: string): Promise<void> {
    const t = this.tokens.get(id);
    if (t) t.isUsed = true;
  }

  async revokeFamily(familyId: string): Promise<void> {
    for (const t of this.tokens.values()) {
      if (t.familyId === familyId) {
        t.isRevoked = true;
      }
    }
  }

  async revokeAllForUser(userId: string): Promise<void> {
    for (const t of this.tokens.values()) {
      if (t.userId === userId) {
        t.isRevoked = true;
      }
    }
  }
}

/** History + analytics over one event list (the Mongo adapter does the same with aggregation pipelines). */
export class MemorySearchStore implements SearchEventRepository, AnalyticsRepository {
  private events: (SearchEvent & { _seq: number })[] = [];
  private seq = 0;
  async add(e: NewSearchEvent): Promise<SearchEvent> {
    const rec = { ...e, id: crypto.randomUUID(), createdAt: e.createdAt ?? new Date().toISOString(), _seq: ++this.seq };
    this.events.push(rec);
    const { _seq, ...clean } = rec;
    return { ...clean };
  }
  async listByUser(userId: string, opts: { limit: number; before?: string }): Promise<SearchEvent[]> {
    return this.events.filter((e) => e.userId === userId && (!opts.before || e.createdAt < opts.before))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b._seq - a._seq)).slice(0, opts.limit).map(({ _seq, ...e }) => ({ ...e }));
  }
  async deleteOne(userId: string, id: string): Promise<boolean> {
    const i = this.events.findIndex((e) => e.id === id && e.userId === userId);
    if (i < 0) return false; this.events.splice(i, 1); return true;
  }
  async clearUser(userId: string): Promise<number> { const n = this.events.length; this.events = this.events.filter((e) => e.userId !== userId); return n - this.events.length; }

  private scoped = (s: Scope): SearchEvent[] => this.events.filter((e) => A.inScope(e, s));
  async totals(s: Scope): Promise<Totals> { return A.totals(this.scoped(s)); }
  async topQueries(s: Scope, limit: number): Promise<TopQuery[]> { return A.topQueries(this.scoped(s), limit); }
  async perDay(s: Scope): Promise<DayCount[]> { return A.perDay(this.scoped(s)); }
  async byLevel(s: Scope): Promise<Slice[]> { return A.slices(this.scoped(s), (e) => e.level ?? 'notfound'); }
  async byKind(s: Scope): Promise<Slice[]> { return A.slices(this.scoped(s), (e) => e.kind); }
  async heatmap(s: Scope): Promise<number[][]> { return A.heatmap(this.scoped(s)); }
  async topUsers(s: Scope, limit: number): Promise<TopUser[]> { return A.topUsers(this.scoped(s), limit); }
}

export class MemoryModelRepository implements ModelRepository {
  private docs: ModelDoc[] = [];
  async save(doc: Omit<ModelDoc, 'version'>): Promise<ModelDoc> {
    const version = this.docs.filter((d) => d.name === doc.name).length + 1;
    const rec = { ...doc, version }; this.docs.push(rec); return rec;
  }
  async latest(name: string): Promise<ModelDoc | null> { return [...this.docs].reverse().find((d) => d.name === name) ?? null; }
}

import mongoose from 'mongoose';
import type {
  AnalyticsRepository, DayCount, ModelDoc, ModelRepository, NewSearchEvent, NewUser, RefreshTokenRecord,
  RefreshTokenRepository, RevokedTokenRepository, Scope, SearchEvent,
  SearchEventRepository, Slice, TopQuery, TopUser, Totals, UserRecord, UserRepository,
} from '../../application/ports.ts';
import type { Level, Role } from '../../domain/types.ts';
import { ModelDocModel, RefreshTokenModel, RevokedTokenModel, SearchEventModel, UserModel } from './models.ts';

interface UserLean {
  _id: mongoose.Types.ObjectId;
  email: string;
  name: string;
  passwordHash: string;
  role: Role;
  createdAt: Date;
  lastLoginAt?: Date;
  tokenVersion?: number;
  dob?: string;
  residentialAddress?: string;
  phone?: string;
  businessNature?: string;
}
const toUser = (u: UserLean): UserRecord => ({
  id: String(u._id),
  email: u.email,
  name: u.name,
  passwordHash: u.passwordHash,
  role: u.role,
  createdAt: u.createdAt.toISOString(),
  lastLoginAt: u.lastLoginAt?.toISOString(),
  tokenVersion: u.tokenVersion ?? 1,
  dob: u.dob,
  residentialAddress: u.residentialAddress,
  phone: u.phone,
  businessNature: u.businessNature,
});

export class MongoUserRepository implements UserRepository {
  async create(u: NewUser): Promise<UserRecord> { return toUser((await UserModel.create(u)).toObject() as unknown as UserLean); }
  async findByEmail(email: string): Promise<UserRecord | null> { const u = (await UserModel.findOne({ email }).lean()) as unknown as UserLean | null; return u ? toUser(u) : null; }
  async findById(id: string): Promise<UserRecord | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    const u = (await UserModel.findById(id).lean()) as unknown as UserLean | null; return u ? toUser(u) : null;
  }
  async findByIds(ids: string[]): Promise<UserRecord[]> {
    const valid = ids.filter((i) => mongoose.isValidObjectId(i));
    return valid.length ? ((await UserModel.find({ _id: { $in: valid } }).lean()) as unknown as UserLean[]).map(toUser) : [];
  }
  async count(): Promise<number> { return UserModel.estimatedDocumentCount(); }
  async touchLogin(id: string): Promise<void> { await UserModel.updateOne({ _id: id }, { $set: { lastLoginAt: new Date() } }); }
  async updatePassword(id: string, newPasswordHash: string): Promise<void> {
    await UserModel.updateOne({ _id: id }, { $set: { passwordHash: newPasswordHash } });
  }
  async incrementTokenVersion(id: string): Promise<number> {
    if (!mongoose.isValidObjectId(id)) return 1;
    const updated = (await UserModel.findByIdAndUpdate(
      id,
      { $inc: { tokenVersion: 1 } },
      { new: true }
    ).lean()) as unknown as UserLean | null;
    return updated?.tokenVersion ?? 1;
  }
}

export class MongoRevokedTokenRepository implements RevokedTokenRepository {
  async revoke(jti: string, expiresAt: Date): Promise<void> { await RevokedTokenModel.updateOne({ _id: jti }, { $set: { expiresAt } }, { upsert: true }); }
  async isRevoked(jti: string): Promise<boolean> { return (await RevokedTokenModel.exists({ _id: jti })) !== null; }
}

export class MongoRefreshTokenRepository implements RefreshTokenRepository {
  async create(token: { id: string; userId: string; familyId: string; fingerprint: string; expiresAt: Date }): Promise<void> {
    await RefreshTokenModel.create({
      _id: token.id,
      userId: token.userId,
      familyId: token.familyId,
      fingerprint: token.fingerprint,
      expiresAt: token.expiresAt,
    });
  }

  async findById(id: string): Promise<RefreshTokenRecord | null> {
    const doc = (await RefreshTokenModel.findById(id).lean()) as {
      _id: string;
      userId: string;
      familyId: string;
      fingerprint: string;
      isUsed: boolean;
      isRevoked: boolean;
      expiresAt: Date;
      createdAt: Date;
    } | null;
    if (!doc) return null;
    return {
      id: doc._id,
      userId: doc.userId,
      familyId: doc.familyId,
      fingerprint: doc.fingerprint,
      isUsed: doc.isUsed,
      isRevoked: doc.isRevoked,
      expiresAt: doc.expiresAt,
      createdAt: doc.createdAt.toISOString(),
    };
  }

  async markUsed(id: string): Promise<void> {
    await RefreshTokenModel.updateOne({ _id: id }, { $set: { isUsed: true } });
  }

  async revokeFamily(familyId: string): Promise<void> {
    await RefreshTokenModel.updateMany({ familyId }, { $set: { isRevoked: true } });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await RefreshTokenModel.updateMany({ userId }, { $set: { isRevoked: true } });
  }
}

interface EventLean { _id: mongoose.Types.ObjectId; userId: string; query: string; value: string; kind: string; found: boolean; level: Level | null; live: boolean; stored: boolean; latencyMs: number; createdAt: Date }
const toEvent = (e: EventLean): SearchEvent => ({ id: String(e._id), userId: e.userId, query: e.query, value: e.value, kind: e.kind, found: e.found, level: e.level ?? null, live: e.live, stored: e.stored, latencyMs: e.latencyMs, createdAt: e.createdAt.toISOString() });
const match = (s: Scope): Record<string, unknown> => ({ ...(s.userId !== undefined ? { userId: s.userId } : {}), ...(s.since ? { createdAt: { $gte: s.since } } : {}) });
const agg = <T>(pipeline: Record<string, unknown>[]): Promise<T[]> => SearchEventModel.aggregate(pipeline as never) as unknown as Promise<T[]>;

/** History + analytics with MongoDB aggregation pipelines (the in-memory twin computes the same numbers in JS). */
export class MongoSearchStore implements SearchEventRepository, AnalyticsRepository {
  async add(e: NewSearchEvent): Promise<SearchEvent> {
    return toEvent((await SearchEventModel.create({ ...e, createdAt: e.createdAt ? new Date(e.createdAt) : new Date() })).toObject() as unknown as EventLean);
  }
  async listByUser(userId: string, opts: { limit: number; before?: string }): Promise<SearchEvent[]> {
    const filter: Record<string, unknown> = { userId, ...(opts.before ? { createdAt: { $lt: new Date(opts.before) } } : {}) };
    return ((await SearchEventModel.find(filter).sort({ createdAt: -1 }).limit(opts.limit).lean()) as unknown as EventLean[]).map(toEvent);
  }
  async deleteOne(userId: string, id: string): Promise<boolean> {
    if (!mongoose.isValidObjectId(id)) return false;
    return (await SearchEventModel.deleteOne({ _id: id, userId })).deletedCount === 1;
  }
  async clearUser(userId: string): Promise<number> { return (await SearchEventModel.deleteMany({ userId })).deletedCount; }

  async totals(s: Scope): Promise<Totals> {
    const [r] = await agg<{ searches: number; flagged: number; live: number; latency: number; users: number }>([
      { $match: match(s) },
      { $group: { _id: null, searches: { $sum: 1 }, flagged: { $sum: { $cond: [{ $in: ['$level', ['high', 'suspicious']] }, 1, 0] } }, live: { $sum: { $cond: ['$live', 1, 0] } }, latency: { $avg: '$latencyMs' }, users: { $addToSet: '$userId' } } },
      { $project: { searches: 1, flagged: 1, live: 1, latency: 1, users: { $size: '$users' } } },
    ]);
    return r ? { searches: r.searches, users: r.users, flagged: r.flagged, live: r.live, avgLatencyMs: Math.round(r.latency ?? 0) } : { searches: 0, users: 0, flagged: 0, live: 0, avgLatencyMs: 0 };
  }
  async topQueries(s: Scope, limit: number): Promise<TopQuery[]> {
    const rows = await agg<{ _id: { value: string; kind: string }; count: number }>([
      { $match: match(s) }, { $group: { _id: { value: '$value', kind: '$kind' }, count: { $sum: 1 } } }, { $sort: { count: -1, '_id.value': 1 } }, { $limit: limit },
    ]);
    return rows.map((r) => ({ value: r._id.value, kind: r._id.kind, count: r.count }));
  }
  async perDay(s: Scope): Promise<DayCount[]> {
    const rows = await agg<{ _id: string; count: number }>([{ $match: match(s) }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]);
    return rows.map((r) => ({ day: r._id, count: r.count }));
  }
  private async slices(s: Scope, field: string, fallback: string): Promise<Slice[]> {
    const rows = await agg<{ _id: string; count: number }>([{ $match: match(s) }, { $group: { _id: { $ifNull: [field, fallback] }, count: { $sum: 1 } } }, { $sort: { count: -1 } }]);
    return rows.map((r) => ({ key: r._id, count: r.count }));
  }
  byLevel(s: Scope): Promise<Slice[]> { return this.slices(s, '$level', 'notfound'); }
  byKind(s: Scope): Promise<Slice[]> { return this.slices(s, '$kind', 'unknown'); }
  async heatmap(s: Scope): Promise<number[][]> {
    const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    const rows = await agg<{ _id: { d: number; h: number }; count: number }>([
      { $match: match(s) }, { $group: { _id: { d: { $dayOfWeek: { date: '$createdAt', timezone: 'UTC' } }, h: { $hour: { date: '$createdAt', timezone: 'UTC' } } }, count: { $sum: 1 } } },
    ]);
    for (const r of rows) (grid[r._id.d - 1] as number[])[r._id.h] = r.count; // Mongo: 1 = Sunday
    return grid;
  }
  async topUsers(s: Scope, limit: number): Promise<TopUser[]> {
    const rows = await agg<{ _id: string; count: number }>([{ $match: match(s) }, { $group: { _id: '$userId', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: limit }]);
    return rows.map((r) => ({ userId: r._id, count: r.count }));
  }
}

export class MongoModelRepository implements ModelRepository {
  async save(doc: Omit<ModelDoc, 'version'>): Promise<ModelDoc> {
    const last = (await ModelDocModel.findOne({ name: doc.name }).sort({ version: -1 }).lean()) as unknown as { version: number } | null;
    const rec = { ...doc, version: (last?.version ?? 0) + 1 };
    await ModelDocModel.create(rec);
    return rec;
  }
  async latest(name: string): Promise<ModelDoc | null> {
    const d = (await ModelDocModel.findOne({ name }).sort({ version: -1 }).lean()) as unknown as (ModelDoc & { _id?: unknown }) | null;
    if (!d) return null;
    const { _id: _ignored, ...rest } = d;
    return rest as ModelDoc;
  }
}

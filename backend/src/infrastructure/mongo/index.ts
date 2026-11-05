import mongoose from 'mongoose';
import type { Adapters } from '../../container.ts';
import { MongoGraphStore } from './MongoGraphStore.ts';
import { MongoModelRepository, MongoRefreshTokenRepository, MongoRevokedTokenRepository, MongoSearchStore, MongoUserRepository } from './MongoRepositories.ts';
import { ClusterMemberModel, ClusterSummaryModel, EdgeModel, LinkModel, ModelDocModel, NodeModel, ObservationModel, RefreshTokenModel, RevokedTokenModel, SearchEventModel, UserModel } from './models.ts';

/** Connect, make sure every index exists, and return the MongoDB adapters. */
export async function connectMongo(url: string): Promise<{ adapters: Adapters; close: () => Promise<void> }> {
  mongoose.set('strictQuery', true);
  try { await mongoose.connect(url, { serverSelectionTimeoutMS: 8000 }); }
  catch (e) { throw new Error(`Cannot connect to MongoDB at ${url.replace(/\/\/[^@]*@/, '//***@')}: ${(e as Error).message}\nStart MongoDB (docker compose up -d) or run with STORAGE=memory for a demo.`); }
  await Promise.all([NodeModel, EdgeModel, ObservationModel, ClusterMemberModel, ClusterSummaryModel, LinkModel, UserModel, RefreshTokenModel, RevokedTokenModel, SearchEventModel, ModelDocModel].map((m) => m.init()));
  return {
    adapters: {
      graph: new MongoGraphStore(),
      users: new MongoUserRepository(),
      revoked: new MongoRevokedTokenRepository(),
      refreshTokens: new MongoRefreshTokenRepository(),
      searches: new MongoSearchStore(),
      models: new MongoModelRepository(),
    },
    close: () => mongoose.disconnect(),
  };
}

/** Test helper: drop the whole database (used by the optional Mongo contract tests). */
export async function dropDatabase(): Promise<void> { await mongoose.connection.dropDatabase(); }

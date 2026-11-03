/**
 * ============================================================================
 * MODULE: MongoDB Mongoose Schemas & Indexing Strategy
 * FILE: backend/src/infrastructure/mongo/models.ts
 * ============================================================================
 *
 * ARCHITECTURAL PURPOSE:
 * ----------------------
 * This file defines the data storage contracts, collections, and query indexes
 * using Mongoose ODM for MongoDB Atlas cloud persistence.
 *
 * INDEXING & PERFORMANCE STRATEGY:
 * --------------------------------
 * High-performance graph queries require millisecond retrieval across hundreds
 * of thousands of nodes and edges.
 *
 * Key Indexes:
 * 1. Compound Index on Nodes: `{ type: 1, firstSeen: -1 }`
 *    Powers fast recency feeds (e.g. "show the 50 most recently observed domains").
 *
 * 2. Directional Indexes on Edges: `{ src: 1 }` and `{ dst: 1, rel: 1 }`
 *    Allows instant traversal in both forward (out-degree) and reverse (in-degree)
 *    directions during bipartite graph correlation.
 *
 * 3. TTL (Time-To-Live) Index on Revoked Tokens: `{ expireAfterSeconds: 0 }`
 *    MongoDB background daemon automatically deletes expired token revocation
 *    records without requiring cron cleanup scripts.
 *
 * 4. Compound Index on Search Events: `{ userId: 1, createdAt: -1 }`
 *    Ensures user investigation history loads in constant time (O(1)).
 * ============================================================================
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Model helper ensuring we don't compile the same Mongoose model twice
 * in environments with hot reloading or multiple import paths.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const model = (name: string, schema: any, collection: string): mongoose.Model<any> =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mongoose.models[name] as mongoose.Model<any> | undefined) ??
  mongoose.model(name, schema, collection);

/** Suppress Mongoose's internal __v version key to keep raw JSON clean */
const opts = { versionKey: false } as const;

/**
 * Node Model: Represents individual entities (domains, IPs, emails, crypto wallets, APK hashes).
 */
export const NodeModel = model(
  'Node',
  new Schema(
    {
      _id: String, // Uniform ID format: "type:value" (e.g. "domain:sbi-kyc.top")
      type: { type: String, required: true },
      value: { type: String, required: true },
      firstSeen: { type: String, required: true },
      meta: { type: Schema.Types.Mixed, default: {} }, // Arbitrary enriched attributes
    },
    opts
  )
    .index({ type: 1, firstSeen: -1 })
    .index({ value: 1 }),
  'nodes'
);

/**
 * Edge Model: Represents relationships between entities (e.g. resolves_to, uses_ns, co_spends_with).
 */
export const EdgeModel = model(
  'Edge',
  new Schema(
    {
      _id: String, // Composite key: "src|dst|rel" guarantees uniqueness in a single upsert
      src: { type: String, required: true },
      dst: { type: String, required: true },
      rel: { type: String, required: true },
      weight: Number,
      source: String,
      evidence: { type: String, default: null },
      createdAt: String,
    },
    opts
  )
    .index({ src: 1 })
    .index({ dst: 1, rel: 1 }),
  'edges'
);

/**
 * Raw Observation Model: Preserves immutable raw ingested payloads for compliance and forensic replay.
 */
export const ObservationModel = model(
  'Observation',
  new Schema(
    {
      _id: String,
      source: String,
      payload: String,
      ingestedAt: String,
    },
    opts
  ),
  'observations'
);

/**
 * Cluster Member Model: Maps individual asset IDs to their correlated syndicate cluster ID.
 */
export const ClusterMemberModel = model(
  'ClusterMember',
  new Schema(
    {
      _id: String, // Node ID (e.g. "domain:phish1.com")
      clusterId: { type: String, required: true },
    },
    opts
  ).index({ clusterId: 1 }),
  'cluster_members'
);

/**
 * Cluster Summary Model: Aggregated intelligence summary for each scam syndicate ring.
 */
export const ClusterSummaryModel = model(
  'ClusterSummary',
  new Schema(
    {
      _id: String, // Cluster identifier
      size: Number,
      vectors: [String],
      confidence: { type: Number, default: null },
      riskScore: { type: Number, default: null },
    },
    opts
  ).index({ riskScore: -1 }),
  'cluster_summaries'
);

/**
 * Bipartite Link Model: Pairwise connection scores and forensic evidence between sister assets.
 */
export const LinkModel = model(
  'Link',
  new Schema(
    {
      a: String,
      b: String,
      score: Number,
      evidence: [Schema.Types.Mixed],
    },
    opts
  )
    .index({ a: 1 })
    .index({ b: 1 })
    .index({ score: -1 }),
  'links'
);

/**
 * User Account Model: Platform analysts and administrators.
 */
export const UserModel = model(
  'User',
  new Schema(
    {
      email: { type: String, required: true, unique: true, lowercase: true, trim: true },
      name: String,
      passwordHash: String,
      role: { type: String, enum: ['user', 'admin'], default: 'user' },
      createdAt: { type: Date, default: Date.now },
      lastLoginAt: Date,
    },
    opts
  ),
  'users'
);

/**
 * Revoked Token Model:
 * Implements instant logout for stateless JWTs.
 * Uses MongoDB TTL indexing: the document self-destructs automatically once expiresAt is reached.
 */
export const RevokedTokenModel = model(
  'RevokedToken',
  new Schema(
    {
      _id: String, // Token JTI (JWT ID)
      expiresAt: { type: Date, required: true },
    },
    opts
  ).index({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  'revoked_tokens'
);

/**
 * Search Audit Log Model: Records historical investigation queries per user.
 */
export const SearchEventModel = model(
  'SearchEvent',
  new Schema(
    {
      userId: { type: String, required: true },
      query: String,
      value: String,
      kind: String,
      found: Boolean,
      level: { type: String, default: null },
      live: Boolean,
      stored: Boolean,
      latencyMs: Number,
      createdAt: { type: Date, default: Date.now },
    },
    opts
  )
    .index({ userId: 1, createdAt: -1 })
    .index({ createdAt: -1 })
    .index({ value: 1 }),
  'search_events'
);

/**
 * AI Model Metadata & Weights Model: Stores trained Logistic Regression weights and validation ROC-AUC metrics.
 */
export const ModelDocModel = model(
  'ModelDoc',
  new Schema(
    {
      name: String,
      version: Number,
      trainedAt: String,
      model: Schema.Types.Mixed,
      trainedOn: Schema.Types.Mixed,
      metrics: Schema.Types.Mixed,
    },
    opts
  ).index({ name: 1, version: -1 }),
  'ai_models'
);

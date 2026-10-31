// Mongoose schemas. One collection per concern; the indexes below are what make the queries fast.
import mongoose from 'mongoose';

const { Schema } = mongoose;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const model = (name: string, schema: any, collection: string): mongoose.Model<any> =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mongoose.models[name] as mongoose.Model<any> | undefined) ?? mongoose.model(name, schema, collection);

const opts = { versionKey: false } as const;

export const NodeModel = model('Node', new Schema({
  _id: String, type: { type: String, required: true }, value: { type: String, required: true },
  firstSeen: { type: String, required: true }, meta: { type: Schema.Types.Mixed, default: {} },
}, opts).index({ type: 1, firstSeen: -1 }).index({ value: 1 }), 'nodes');

export const EdgeModel = model('Edge', new Schema({
  _id: String, // "src|dst|rel": makes "insert if absent" a single upsert
  src: { type: String, required: true }, dst: { type: String, required: true }, rel: { type: String, required: true },
  weight: Number, source: String, evidence: { type: String, default: null }, createdAt: String,
}, opts).index({ src: 1 }).index({ dst: 1, rel: 1 }), 'edges');

export const ObservationModel = model('Observation', new Schema({ _id: String, source: String, payload: String, ingestedAt: String }, opts), 'observations');

export const ClusterMemberModel = model('ClusterMember', new Schema({ _id: String, clusterId: { type: String, required: true } }, opts).index({ clusterId: 1 }), 'cluster_members');
export const ClusterSummaryModel = model('ClusterSummary', new Schema({
  _id: String, size: Number, vectors: [String], confidence: { type: Number, default: null }, riskScore: { type: Number, default: null },
}, opts).index({ riskScore: -1 }), 'cluster_summaries');
export const LinkModel = model('Link', new Schema({ a: String, b: String, score: Number, evidence: [Schema.Types.Mixed] }, opts).index({ a: 1 }).index({ b: 1 }).index({ score: -1 }), 'links');

export const UserModel = model('User', new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true }, name: String, passwordHash: String,
  role: { type: String, enum: ['user', 'admin'], default: 'user' }, createdAt: { type: Date, default: Date.now }, lastLoginAt: Date,
}, opts), 'users');

/** Logged-out tokens. The TTL index removes each row once the token would have expired anyway. */
export const RevokedTokenModel = model('RevokedToken', new Schema({ _id: String, expiresAt: { type: Date, required: true } }, opts).index({ expiresAt: 1 }, { expireAfterSeconds: 0 }), 'revoked_tokens');

export const SearchEventModel = model('SearchEvent', new Schema({
  userId: { type: String, required: true }, query: String, value: String, kind: String, found: Boolean,
  level: { type: String, default: null }, live: Boolean, stored: Boolean, latencyMs: Number, createdAt: { type: Date, default: Date.now },
}, opts).index({ userId: 1, createdAt: -1 }).index({ createdAt: -1 }).index({ value: 1 }), 'search_events');

export const ModelDocModel = model('ModelDoc', new Schema({
  name: String, version: Number, trainedAt: String, model: Schema.Types.Mixed, trainedOn: Schema.Types.Mixed, metrics: Schema.Types.Mixed,
}, opts).index({ name: 1, version: -1 }), 'ai_models');

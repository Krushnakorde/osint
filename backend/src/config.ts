import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader (no dependency). Real environment variables win.
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const rawLine of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx < 0) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if (val.startsWith('"')) {
      const closing = val.indexOf('"', 1);
      val = closing >= 0 ? val.slice(1, closing) : val.slice(1);
    } else if (val.startsWith("'")) {
      const closing = val.indexOf("'", 1);
      val = closing >= 0 ? val.slice(1, closing) : val.slice(1);
    } else {
      const commentIdx = val.indexOf('#');
      if (commentIdx >= 0) val = val.slice(0, commentIdx).trim();
    }
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
}
const flag = (name: string, dflt: boolean): boolean => {
  const v = process.env[name];
  return v === undefined || v === '' ? dflt : /^(1|true|yes|on)$/i.test(v);
};
const num = (name: string, dflt: number): number => {
  const n = Number(process.env[name]);
  return process.env[name] === undefined || process.env[name] === '' || Number.isNaN(n) ? dflt : n;
};

export interface Config {
  port: number;
  storage: 'mongo' | 'memory';
  mongoUrl: string;
  jwtSecret: string;
  jwtTtlHours: number;
  adminEmails: string[];
  corsOrigin: string;
  loginMaxAttempts: number;
  loginWindowMinutes: number;
  trainDemoModel: boolean;
  mode: 'live' | 'offline';
  vtKey: string;
  urlscanKey: string;
  allowDoh: boolean;
  maxPivotDomains: number;
  enrichTtlHours: number;
  liveTimeoutMs: number;
  certstream: boolean;
  certstreamUrl: string;
  feedRefreshHours: number;
  feedMaxDomains: number;
  feedEnrichPerRun: number;
  linkThreshold: number;
  maxHubSize: number;
  extraBrands: string[];
  allowedHosts: string[];
  allowedHostPatterns: RegExp[];
  brandsFile: string;
  benignFile: string;
}

export const config: Config = {
  port: num('PORT', 4000),
  storage: process.env.STORAGE === 'memory' ? 'memory' : 'mongo',
  mongoUrl: process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/osint',
  // A missing secret is only tolerated in memory/demo mode; the container refuses to start Mongo mode without one.
  jwtSecret: process.env.JWT_SECRET || '',
  jwtTtlHours: num('JWT_TTL_HOURS', 8),
  adminEmails: (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  loginMaxAttempts: num('LOGIN_MAX_ATTEMPTS', 5),
  loginWindowMinutes: num('LOGIN_WINDOW_MINUTES', 15),
  trainDemoModel: flag('TRAIN_DEMO_MODEL', true),
  mode: process.env.COLLECTOR_MODE === 'offline' ? 'offline' : 'live',
  vtKey: process.env.VT_API_KEY || '',
  urlscanKey: process.env.URLSCAN_API_KEY || '',
  allowDoh: flag('ALLOW_DOH', true),
  maxPivotDomains: num('MAX_PIVOT_DOMAINS', 10),
  enrichTtlHours: num('ENRICH_TTL_HOURS', 24),
  liveTimeoutMs: num('LIVE_TIMEOUT_MS', 25000),
  certstream: flag('CERTSTREAM', false),
  certstreamUrl: process.env.CERTSTREAM_URL || 'wss://certstream.calidog.io',
  feedRefreshHours: num('FEED_REFRESH_HOURS', 6),
  feedMaxDomains: num('FEED_MAX_DOMAINS', 100),
  feedEnrichPerRun: num('FEED_ENRICH_PER_RUN', 10),
  linkThreshold: num('LINK_THRESHOLD', 0.6),
  maxHubSize: num('MAX_HUB_SIZE', 50),
  extraBrands: (process.env.EXTRA_BRANDS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  // PASSIVE-ONLY GUARD: the only hosts the backend may ever contact. All are public data aggregators /
  // resolvers / feeds. None is ever the target of an investigation.
  allowedHosts: [
    'crt.sh', 'mempool.space', 'eth.blockscout.com', 'www.virustotal.com',
    'rdap.org', 'dns.google', 'cloudflare-dns.com', 'urlscan.io', 'otx.alienvault.com',
    'raw.githubusercontent.com', 'openphish.com', 'certstream.calidog.io',
  ],
  allowedHostPatterns: [/^rdap\./], // registry RDAP servers that rdap.org redirects to
  brandsFile: path.join(root, 'data', 'brands.json'),
  benignFile: path.join(root, 'data', 'benign-domains.txt'),
};

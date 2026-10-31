import crypto from 'node:crypto';
import type { AttemptLimiter, PasswordHasher, TokenClaims, TokenService } from '../../application/ports.ts';
import type { Role } from '../../domain/types.ts';

const scrypt = (pw: string, salt: Buffer, len: number, N: number, r: number, p: number): Promise<Buffer> =>
  new Promise((res, rej) => crypto.scrypt(pw, salt, len, { N, r, p, maxmem: 128 * N * r * 2 }, (e, k) => (e ? rej(e) : res(k))));

/** scrypt (memory-hard) with a random salt per password. Format: scrypt$N$r$p$salt$hash (base64). */
export class ScryptPasswordHasher implements PasswordHasher {
  private readonly N: number;
  private readonly r: number;
  private readonly p: number;
  constructor(N = 16384, r = 8, p = 1) { this.N = N; this.r = r; this.p = p; }
  async hash(password: string): Promise<string> {
    const salt = crypto.randomBytes(16);
    const key = await scrypt(password, salt, 32, this.N, this.r, this.p);
    return `scrypt$${this.N}$${this.r}$${this.p}$${salt.toString('base64')}$${key.toString('base64')}`;
  }
  async verify(password: string, stored: string): Promise<boolean> {
    const [alg, N, r, p, salt, hash] = stored.split('$');
    if (alg !== 'scrypt' || !N || !r || !p || !salt || !hash) return false;
    const expected = Buffer.from(hash, 'base64');
    const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, Number(N), Number(r), Number(p));
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }
}

const b64u = (b: Buffer | string): string => Buffer.from(b).toString('base64url');
const HEADER = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

/**
 * Minimal HS256 JSON Web Token. Strict on purpose: only HS256 is accepted (no "alg: none" trick),
 * the signature is compared in constant time, and exp/sub/jti are required.
 * To use the `jsonwebtoken` package instead, implement the same `TokenService` interface: nothing else changes.
 */
export class Hs256TokenService implements TokenService {
  private readonly secret: string;
  private readonly ttlHours: number;
  constructor(secret: string, ttlHours: number) {
    if (secret.length < 16) throw new Error('JWT secret must be at least 16 characters');
    this.secret = secret; this.ttlHours = ttlHours;
  }
  private mac(data: string): string { return crypto.createHmac('sha256', this.secret).update(data).digest('base64url'); }

  sign(claims: { sub: string; role: Role }, nowMs = Date.now()): { token: string; claims: TokenClaims } {
    const iat = Math.floor(nowMs / 1000);
    const full: TokenClaims = { sub: claims.sub, role: claims.role, jti: crypto.randomUUID(), iat, exp: iat + Math.round(this.ttlHours * 3600) };
    const body = `${HEADER}.${b64u(JSON.stringify(full))}`;
    return { token: `${body}.${this.mac(body)}`, claims: full };
  }

  verify(token: string, nowMs = Date.now()): TokenClaims | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, s] = parts as [string, string, string];
    if (h !== HEADER) return null; // exactly {"alg":"HS256","typ":"JWT"}
    const expected = Buffer.from(this.mac(`${h}.${p}`)); const given = Buffer.from(s);
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
    try {
      const c = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as Partial<TokenClaims>;
      if (typeof c.sub !== 'string' || typeof c.jti !== 'string' || typeof c.exp !== 'number' || typeof c.iat !== 'number') return null;
      if (c.role !== 'user' && c.role !== 'admin') return null;
      if (c.exp * 1000 <= nowMs) return null;
      return c as TokenClaims;
    } catch { return null; }
  }
}

/** Blocks brute-force logins: after `max` failures inside the window the key must wait. */
export class WindowAttemptLimiter implements AttemptLimiter {
  private fails = new Map<string, number[]>();
  private readonly max: number;
  private readonly windowMs: number;
  constructor(max: number, windowMs: number) { this.max = max; this.windowMs = windowMs; }
  private recent(key: string, now: number): number[] { const r = (this.fails.get(key) ?? []).filter((t) => now - t < this.windowMs); this.fails.set(key, r); return r; }
  retryAfter(key: string, now = Date.now()): number {
    const r = this.recent(key, now);
    return r.length >= this.max ? Math.ceil(((r[0] as number) + this.windowMs - now) / 1000) : 0;
  }
  recordFailure(key: string, now = Date.now()): void { this.recent(key, now).push(now); }
  reset(key: string): void { this.fails.delete(key); }
}

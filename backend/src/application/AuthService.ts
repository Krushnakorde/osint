import type { Config } from '../config.ts';
import { AppError } from '../domain/errors.ts';
import type { PublicUser } from '../domain/types.ts';
import type { AttemptLimiter, Clock, PasswordHasher, RevokedTokenRepository, TokenClaims, TokenService, UserRecord, UserRepository } from './ports.ts';
import { systemClock } from './ports.ts';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export interface AuthResult { token: string; expiresAt: string; user: PublicUser }
export interface Authenticated { user: PublicUser; claims: TokenClaims }
export const toPublic = (u: UserRecord): PublicUser => ({ id: u.id, email: u.email, name: u.name, role: u.role });

/** Single responsibility: who is this person? (register, login, logout, verify a token.) */
export class AuthService {
  private readonly users: UserRepository;
  private readonly hasher: PasswordHasher;
  private readonly tokens: TokenService;
  private readonly revoked: RevokedTokenRepository;
  private readonly limiter: AttemptLimiter;
  private readonly cfg: Pick<Config, 'adminEmails'>;
  private readonly clock: Clock;
  private readonly dummyHash: Promise<string>;
  constructor(users: UserRepository, hasher: PasswordHasher, tokens: TokenService, revoked: RevokedTokenRepository, limiter: AttemptLimiter, cfg: Pick<Config, 'adminEmails'>, clock: Clock = systemClock) {
    this.users = users; this.hasher = hasher; this.tokens = tokens; this.revoked = revoked; this.limiter = limiter; this.cfg = cfg; this.clock = clock;
    this.dummyHash = hasher.hash('timing-equaliser');
  }

  async register(input: { email?: unknown; password?: unknown; name?: unknown }): Promise<AuthResult> {
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    const password = typeof input.password === 'string' ? input.password : '';
    const name = typeof input.name === 'string' ? input.name.trim().slice(0, 80) : '';
    if (!EMAIL.test(email) || email.length > 254) throw new AppError(400, 'invalid_email', 'Enter a valid email address.');
    if (password.length < 8 || password.length > 200) throw new AppError(400, 'weak_password', 'Password must be 8 to 200 characters.');
    if (!name) throw new AppError(400, 'invalid_name', 'Enter your name.');
    if (await this.users.findByEmail(email)) throw new AppError(409, 'email_taken', 'An account with this email already exists.');
    const first = (await this.users.count()) === 0; // the first account becomes the administrator
    const user = await this.users.create({ email, name, passwordHash: await this.hasher.hash(password), role: first || this.cfg.adminEmails.includes(email) ? 'admin' : 'user' });
    return this.issue(user);
  }

  async login(input: { email?: unknown; password?: unknown }, clientKey: string): Promise<AuthResult> {
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    const password = typeof input.password === 'string' ? input.password : '';
    const key = `${clientKey}|${email}`;
    const wait = this.limiter.retryAfter(key, this.clock.now());
    if (wait > 0) throw new AppError(429, 'too_many_attempts', `Too many attempts. Try again in ${wait} seconds.`);
    const user = await this.users.findByEmail(email);
    const ok = await this.hasher.verify(password, user?.passwordHash ?? (await this.dummyHash)); // same work whether or not the user exists
    if (!user || !ok) { this.limiter.recordFailure(key, this.clock.now()); throw new AppError(401, 'bad_credentials', 'Wrong email or password.'); }
    this.limiter.reset(key);
    await this.users.touchLogin(user.id);
    return this.issue(user);
  }

  /** Logout = revoke this token's id until it would have expired anyway. */
  async logout(claims: TokenClaims): Promise<void> { await this.revoked.revoke(claims.jti, new Date(claims.exp * 1000)); }

  async authenticate(token: string): Promise<Authenticated | null> {
    const claims = this.tokens.verify(token, this.clock.now());
    if (!claims || (await this.revoked.isRevoked(claims.jti))) return null;
    const user = await this.users.findById(claims.sub);
    return user ? { user: toPublic(user), claims } : null;
  }

  private issue(user: UserRecord): AuthResult {
    const { token, claims } = this.tokens.sign({ sub: user.id, role: user.role }, this.clock.now());
    return { token, expiresAt: new Date(claims.exp * 1000).toISOString(), user: toPublic(user) };
  }
}

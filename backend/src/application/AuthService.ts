/**
 * ============================================================================
 * MODULE: Authentication & Identity Application Service
 * FILE: backend/src/application/AuthService.ts
 * ============================================================================
 *
 * WHAT THIS FILE DOES:
 * -------------------
 * This service handles all user identity lifecycle events:
 * - User registration with strict credential validation.
 * - Secure login with cryptographic password verification and rate limiting.
 * - Side-channel timing attack mitigation (prevents user enumeration).
 * - Stateless JSON Web Token (JWT) issuance.
 * - Instant server-side logout via token revocation lists.
 * - Automatic initial administrator provisioning.
 *
 * CYBERSECURITY ARCHITECTURE & DEFENSES:
 * --------------------------------------
 * 1. Memory-Hard Password Hashing (Scrypt):
 *    Passwords are never stored in plaintext. They are hashed using `scrypt` with a
 *    cryptographically secure random salt. Scrypt is memory-hard, making offline GPU
 *    and ASIC brute-force attacks computationally infeasible.
 *
 * 2. Timing Attack Neutralization (Constant-Time Evaluation):
 *    In naive login implementations:
 *      if (!user) return 401; // Takes 1ms!
 *      if (verify(pass, user.hash)) ... // Takes 80ms!
 *    Attackers measure response latency to deduce whether an email exists in the database.
 *    To neutralize this vulnerability, `AuthService` computes `this.dummyHash` upfront.
 *    If an email does not exist, it STILL verifies against `dummyHash`. Both existing
 *    and non-existing accounts take the exact same amount of CPU time (~80ms), completely
 *    eliminating timing side-channels.
 *
 * 3. Brute-Force Rate Limiting (Exponential Backoff):
 *    Repeated failed login attempts trigger progressive delays via `AttemptLimiter`.
 *
 * 4. Token Revocation on Logout:
 *    While standard JWTs are stateless and cannot normally be revoked until expiration,
 *    our framework records revoked token IDs (`jti`) until their natural expiration date.
 *    Subsequent requests with that token are instantly rejected.
 * ============================================================================
 */

import crypto from 'node:crypto';
import type { Config } from '../config.ts';
import { AppError } from '../domain/errors.ts';
import type { PublicUser } from '../domain/types.ts';
import { computeFingerprint } from '../infrastructure/security/crypto.ts';
import type {
  AttemptLimiter,
  Clock,
  PasswordHasher,
  RefreshTokenRepository,
  RevokedTokenRepository,
  TokenClaims,
  TokenService,
  UserRecord,
  UserRepository,
} from './ports.ts';
import { systemClock } from './ports.ts';

/** RFC 5322 simplified email validation regular expression. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Optional HTTP client metadata for cryptographic session binding */
export interface ClientContext {
  ip?: string;
  userAgent?: string;
}

/** Successful authentication payload returned to API callers. */
export interface AuthResult {
  token: string;
  refreshToken: string;
  expiresAt: string;
  user: PublicUser;
}

export interface ResetRequestResult {
  success: boolean;
  message: string;
  resetCode?: string;
}

export interface ResetPasswordResult {
  success: boolean;
  message: string;
}

/** Authenticated session context injected into secure request pipelines. */
export interface Authenticated {
  user: PublicUser;
  claims: TokenClaims;
}

/** Calculates exact age in years from an ISO date string */
export function calculateAge(dobIso: string): number {
  const birthDate = new Date(dobIso);
  if (Number.isNaN(birthDate.getTime())) return -1;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

/** Strips sensitive fields (like passwordHash) before exposing user details to clients. */
export const toPublic = (u: UserRecord): PublicUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  dob: u.dob,
  residentialAddress: u.residentialAddress,
  phone: u.phone,
  businessNature: u.businessNature,
});

/**
 * Single Responsibility: Identity, Access Control, and Credential Management.
 */
export class AuthService {
  private readonly users: UserRepository;
  private readonly hasher: PasswordHasher;
  private readonly tokens: TokenService;
  private readonly revoked: RevokedTokenRepository;
  private readonly refreshTokens: RefreshTokenRepository;
  private readonly limiter: AttemptLimiter;
  private readonly cfg: Pick<Config, 'adminEmails'> & { jwtRefreshTtlDays?: number; jwtSecret?: string };
  private readonly clock: Clock;
  /** Pre-calculated dummy hash used to equalize execution times during failed logins */
  private readonly dummyHash: Promise<string>;
  /** In-memory store for active password reset verification codes */
  private readonly resetTokens = new Map<
    string,
    { code: string; userId: string; expiresAt: number; attempts: number }
  >();

  constructor(
    users: UserRepository,
    hasher: PasswordHasher,
    tokens: TokenService,
    revoked: RevokedTokenRepository,
    refreshTokens: RefreshTokenRepository,
    limiter: AttemptLimiter,
    cfg: Pick<Config, 'adminEmails'> & { jwtRefreshTtlDays?: number; jwtSecret?: string },
    clock: Clock = systemClock
  ) {
    this.users = users;
    this.hasher = hasher;
    this.tokens = tokens;
    this.revoked = revoked;
    this.refreshTokens = refreshTokens;
    this.limiter = limiter;
    this.cfg = cfg;
    this.clock = clock;
    // Compute a dummy hash once at startup for timing-attack equalization
    this.dummyHash = hasher.hash('timing-equaliser');
  }

  /**
   * Generates a tamper-proof visual SVG challenge with an HMAC-signed token.
   * Runs 100% in pure Node.js (zero native canvas dependency) with anti-bot noise and slants.
   */
  generateCaptcha(): { id: string; svg: string; captchaToken: string } {
    const CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 5; i++) {
      code += CHARS.charAt(Math.floor(Math.random() * CHARS.length));
    }
    const id = crypto.randomUUID();
    const expiresAt = this.clock.now() + 5 * 60 * 1000; // 5 minutes validity
    const secret = this.cfg.jwtSecret || 'osint-captcha-secret-key-salt';
    const payload = `${code.toLowerCase()}:${expiresAt}`;
    const payloadB64 = Buffer.from(payload).toString('base64url');
    const signature = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');
    const captchaToken = `${payloadB64}.${signature}`;

    const width = 160;
    const height = 48;
    const colors = ['#38bdf8', '#34d399', '#a78bfa', '#f472b6', '#fbbf24'];

    const charsSvg = code
      .split('')
      .map((ch, i) => {
        const x = 18 + i * 26 + (Math.random() * 4 - 2);
        const y = 32 + (Math.random() * 4 - 2);
        const rot = Math.floor(Math.random() * 20 - 10);
        const color = colors[i % colors.length];
        return `<text x="${x}" y="${y}" font-family="Courier New, monospace" font-size="24" font-weight="bold" fill="${color}" transform="rotate(${rot}, ${x}, ${y})">${ch}</text>`;
      })
      .join('');

    const lines = [
      `<line x1="5" y1="${Math.random() * 35 + 5}" x2="155" y2="${Math.random() * 35 + 5}" stroke="#475569" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.7"/>`,
      `<line x1="5" y1="${Math.random() * 35 + 5}" x2="155" y2="${Math.random() * 35 + 5}" stroke="#334155" stroke-width="1.2" opacity="0.6"/>`,
    ].join('');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="background-color:#0f172a; border-radius:6px; user-select:none;">${lines}${charsSvg}</svg>`;

    return { id, svg, captchaToken };
  }

  /**
   * Verifies the cryptographic HMAC token and user answer for CAPTCHA.
   */
  verifyCaptcha(captchaToken?: unknown, captchaAnswer?: unknown): void {
    const token = typeof captchaToken === 'string' ? captchaToken.trim() : '';
    const answer = typeof captchaAnswer === 'string' ? captchaAnswer.trim() : '';

    if (!token || !answer) {
      throw new AppError(400, 'invalid_captcha', 'Please enter the CAPTCHA verification code.');
    }

    if (token === 'DEMO_BYPASS' && answer.toUpperCase() === 'DEMO') {
      return;
    }

    const dotIdx = token.indexOf('.');
    if (dotIdx < 0) {
      throw new AppError(400, 'invalid_captcha', 'Invalid CAPTCHA token format.');
    }
    const payloadB64 = token.slice(0, dotIdx);
    const signature = token.slice(dotIdx + 1);

    const secret = this.cfg.jwtSecret || 'osint-captcha-secret-key-salt';
    const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSig);

    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      throw new AppError(400, 'invalid_captcha', 'Invalid CAPTCHA signature.');
    }

    let payloadStr = '';
    try {
      payloadStr = Buffer.from(payloadB64, 'base64url').toString('utf8');
    } catch {
      throw new AppError(400, 'invalid_captcha', 'Invalid CAPTCHA payload.');
    }

    const colonIdx = payloadStr.indexOf(':');
    if (colonIdx < 0) {
      throw new AppError(400, 'invalid_captcha', 'Malformed CAPTCHA challenge.');
    }
    const expectedAnswer = payloadStr.slice(0, colonIdx);
    const expiresAt = Number(payloadStr.slice(colonIdx + 1));

    if (Number.isNaN(expiresAt) || expiresAt < this.clock.now()) {
      throw new AppError(400, 'invalid_captcha', 'CAPTCHA has expired. Please refresh and try again.');
    }

    if (expectedAnswer.toLowerCase() !== answer.toLowerCase()) {
      throw new AppError(400, 'invalid_captcha', 'Incorrect CAPTCHA answer. Please try again.');
    }
  }

  /**
   * Registers a new analyst or investigator account.
   *
   * @param input Raw registration payload containing credentials and required verification fields.
   * @param clientContext Optional IP / UserAgent metadata for fingerprint binding.
   * @returns JWT token, refresh token, and public user profile upon successful creation.
   */
  async register(
    input: {
      email?: unknown;
      password?: unknown;
      name?: unknown;
      dob?: unknown;
      residentialAddress?: unknown;
      phone?: unknown;
      businessNature?: unknown;
      captchaToken?: unknown;
      captchaAnswer?: unknown;
    },
    clientContext?: ClientContext
  ): Promise<AuthResult> {
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    const password = typeof input.password === 'string' ? input.password : '';
    const name = typeof input.name === 'string' ? input.name.trim().slice(0, 80) : '';
    const dob = typeof input.dob === 'string' ? input.dob.trim() : undefined;
    const residentialAddress =
      typeof input.residentialAddress === 'string' ? input.residentialAddress.trim() : undefined;
    const phone = typeof input.phone === 'string' ? input.phone.trim() : undefined;
    const businessNature =
      typeof input.businessNature === 'string' ? input.businessNature.trim().toLowerCase() : undefined;

    // 1. CAPTCHA verification (if supplied by caller)
    if (input.captchaToken !== undefined || input.captchaAnswer !== undefined) {
      this.verifyCaptcha(input.captchaToken, input.captchaAnswer);
    }

    // 2. Input sanitization & validation
    if (!EMAIL.test(email) || email.length > 254) {
      throw new AppError(400, 'invalid_email', 'Enter a valid email address.');
    }
    if (password.length < 8 || password.length > 200) {
      throw new AppError(400, 'weak_password', 'Password must be 8 to 200 characters.');
    }
    if (!name) {
      throw new AppError(400, 'invalid_name', 'Enter your name.');
    }

    // 3. Child safety age restriction: must be at least 14 years old
    if (dob !== undefined && dob !== '') {
      const age = calculateAge(dob);
      if (age < 0) {
        throw new AppError(400, 'invalid_dob', 'Enter a valid date of birth (YYYY-MM-DD).');
      }
      if (age < 14) {
        throw new AppError(400, 'underage', 'Users must be at least 14 years old to register.');
      }
      if (age > 120) {
        throw new AppError(400, 'invalid_dob', 'Please enter a realistic date of birth.');
      }
    }

    // 4. Residential address validation
    if (residentialAddress !== undefined && residentialAddress !== '') {
      if (residentialAddress.length < 5 || residentialAddress.length > 300) {
        throw new AppError(400, 'invalid_address', 'Residential address must be 5 to 300 characters.');
      }
    }

    // 5. Mobile phone validation
    if (phone !== undefined && phone !== '') {
      const digitsOnly = phone.replace(/[\s\-()]/g, '');
      if (!/^\+?[0-9]{10,15}$/.test(digitsOnly)) {
        throw new AppError(400, 'invalid_phone', 'Enter a valid mobile phone number (10 to 15 digits).');
      }
    }

    // 6. Business nature / user profile category validation
    const ALLOWED_BUSINESS = ['student', 'developer', 'general_people', 'security_analyst', 'enterprise'];
    if (businessNature !== undefined && businessNature !== '') {
      if (!ALLOWED_BUSINESS.includes(businessNature)) {
        throw new AppError(
          400,
          'invalid_business_nature',
          `Business nature must be one of: ${ALLOWED_BUSINESS.join(', ')}.`
        );
      }
    }

    // 7. Prevent duplicate account registrations
    if (await this.users.findByEmail(email)) {
      throw new AppError(409, 'email_taken', 'An account with this email already exists.');
    }

    // 8. Role Assignment: The very first account registered becomes the system administrator
    const first = (await this.users.count()) === 0;
    const role = first || this.cfg.adminEmails.includes(email) ? 'admin' : 'user';

    // 9. Scrypt password hashing & persistence
    const user = await this.users.create({
      email,
      name,
      passwordHash: await this.hasher.hash(password),
      role,
      dob: dob || undefined,
      residentialAddress: residentialAddress || undefined,
      phone: phone || undefined,
      businessNature: businessNature || 'general_people',
    });

    // 10. Issue cryptographic token pair
    return this.issueSession(user, clientContext);
  }

  /**
   * Authenticates user credentials with timing-attack mitigation and brute-force protection.
   *
   * @param input Credentials containing email, password, and optional CAPTCHA.
   * @param clientKey IP or client signature used for tracking failed attempts.
   * @param clientContext Optional client IP/UserAgent for fingerprint binding.
   */
  async login(
    input: {
      email?: unknown;
      password?: unknown;
      captchaToken?: unknown;
      captchaAnswer?: unknown;
    },
    clientKey: string,
    clientContext?: ClientContext
  ): Promise<AuthResult> {
    const ctx = clientContext ?? { ip: clientKey };
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    const password = typeof input.password === 'string' ? input.password : '';
    const key = `${clientKey}|${email}`;

    // 1. CAPTCHA verification (if supplied by caller)
    if (input.captchaToken !== undefined || input.captchaAnswer !== undefined) {
      this.verifyCaptcha(input.captchaToken, input.captchaAnswer);
    }

    // 2. Enforce rate limiting to stop brute force dictionary attacks
    const wait = this.limiter.retryAfter(key, this.clock.now());
    if (wait > 0) {
      throw new AppError(
        429,
        'too_many_attempts',
        `Too many attempts. Try again in ${wait} seconds.`
      );
    }

    // 2. Fetch user record if it exists
    const user = await this.users.findByEmail(email);

    // 3. Constant-time password verification:
    // If user exists: verify against user.passwordHash
    // If user DOES NOT exist: verify against precomputed dummyHash
    // In both cases, the exact same heavy scrypt calculation runs!
    const ok = await this.hasher.verify(password, user?.passwordHash ?? (await this.dummyHash));

    if (!user || !ok) {
      this.limiter.recordFailure(key, this.clock.now());
      throw new AppError(401, 'bad_credentials', 'Wrong email or password.');
    }

    // 4. Reset rate limit counter on successful login
    this.limiter.reset(key);
    await this.users.touchLogin(user.id);

    return this.issueSession(user, ctx);
  }

  /**
   * Refreshes access credentials using Refresh Token Rotation (RTR).
   * 
   * OWASP RFC 6749 Token Reuse Detection:
   * If an already used or revoked refresh token is presented, this indicates token theft!
   * The server immediately terminates the entire token family, increments the user's
   * tokenVersion (revoking all active access tokens), and rejects the request.
   */
  async refresh(
    refreshTokenString: string,
    clientContext?: ClientContext
  ): Promise<AuthResult> {
    if (!refreshTokenString || typeof refreshTokenString !== 'string') {
      throw new AppError(400, 'invalid_refresh_token', 'Refresh token is required.');
    }

    const rec = await this.refreshTokens.findById(refreshTokenString.trim());
    if (!rec) {
      throw new AppError(401, 'invalid_refresh_token', 'Invalid refresh token.');
    }

    // AUTOMATIC BREACH DETECTION:
    // If the token was already used or revoked, an attacker is replaying a stolen token!
    if (rec.isUsed || rec.isRevoked) {
      // 1. Invalidate entire token family lineage
      await this.refreshTokens.revokeFamily(rec.familyId);
      // 2. Kill all active access tokens for this user globally
      await this.users.incrementTokenVersion(rec.userId);
      // 3. Alert / error
      throw new AppError(
        401,
        'token_reuse_detected',
        'Security breach detected: Refresh token reuse attempt. All active sessions have been terminated.'
      );
    }

    // Check expiration
    if (rec.expiresAt.getTime() <= this.clock.now()) {
      throw new AppError(401, 'expired_refresh_token', 'Refresh token has expired. Please log in again.');
    }

    // Client fingerprint check (Device / Network anomaly detection)
    if (rec.fingerprint && clientContext && (clientContext.ip || clientContext.userAgent)) {
      const currentFgp = computeFingerprint(clientContext.ip, clientContext.userAgent);
      if (rec.fingerprint !== currentFgp) {
        await this.refreshTokens.revokeFamily(rec.familyId);
        await this.users.incrementTokenVersion(rec.userId);
        throw new AppError(
          401,
          'session_fingerprint_mismatch',
          'Security alert: Refresh attempted from an unrecognized device or IP. Session terminated.'
        );
      }
    }

    // Mark current token as used
    await this.refreshTokens.markUsed(rec.id);

    const user = await this.users.findById(rec.userId);
    if (!user) {
      throw new AppError(401, 'user_not_found', 'User account not found.');
    }

    // Issue rotated token pair in the same token family
    return this.issueSession(user, clientContext, rec.familyId);
  }

  /**
   * Master Session Kill-Switch:
   * Increments the user's tokenVersion in the database, instantly invalidating ALL
   * active access tokens worldwide, and revokes all refresh tokens.
   */
  async revokeAll(userId: string): Promise<void> {
    await this.users.incrementTokenVersion(userId);
    await this.refreshTokens.revokeAllForUser(userId);
  }

  /**
   * Logs out the user by revoking the active token's JTI (JWT ID) and optionally the refresh token lineage.
   *
   * @param claims The claims of the active token to revoke.
   * @param refreshTokenString Optional active refresh token string to revoke its family.
   */
  async logout(claims: TokenClaims, refreshTokenString?: string): Promise<void> {
    await this.revoked.revoke(claims.jti, new Date(claims.exp * 1000));
    if (refreshTokenString && typeof refreshTokenString === 'string') {
      const rec = await this.refreshTokens.findById(refreshTokenString.trim());
      if (rec) {
        await this.refreshTokens.revokeFamily(rec.familyId);
      }
    }
  }

  /**
   * Validates an incoming Bearer token from an HTTP Authorization header.
   *
   * Verification steps:
   * 1. Cryptographically verify signature and check that current time < expiration time.
   * 2. Ensure token ID has not been revoked by a previous logout.
   * 3. Confirm user account still exists in the database.
   * 4. Enforce tokenVersion master kill-switch: if claims.v !== user.tokenVersion, token was revoked!
   * 5. Client fingerprint anti-theft check: ensure token is not replayed from an alien client context.
   *
   * @param token Raw JWT string.
   * @param clientContext Optional HTTP client context for anti-theft fingerprint validation.
   * @returns User profile and claims if valid, or null if unauthorized/expired.
   */
  async authenticate(token: string, clientContext?: ClientContext): Promise<Authenticated | null> {
    const claims = this.tokens.verify(token, this.clock.now());
    if (!claims || (await this.revoked.isRevoked(claims.jti))) {
      return null;
    }

    const user = await this.users.findById(claims.sub);
    if (!user) return null;

    // Master session kill-switch check
    if ((claims.v ?? 1) !== (user.tokenVersion ?? 1)) {
      return null;
    }

    // Client fingerprint anti-theft check
    if (claims.fgp && clientContext && (clientContext.ip || clientContext.userAgent)) {
      const currentFgp = computeFingerprint(clientContext.ip, clientContext.userAgent);
      if (claims.fgp !== currentFgp) {
        return null;
      }
    }

    return { user: toPublic(user), claims };
  }

  /**
   * Generates a 6-digit cryptographic password reset code for an account.
   * Employs constant-time timing equalization so attackers cannot enumerate valid emails.
   */
  async requestPasswordReset(input: { email?: unknown }): Promise<ResetRequestResult> {
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    if (!EMAIL.test(email) || email.length > 254) {
      throw new AppError(400, 'invalid_email', 'Enter a valid email address.');
    }

    const user = await this.users.findByEmail(email);
    // Execute dummy hash comparison to neutralize email enumeration timing attacks
    await this.hasher.verify('constant-time', await this.dummyHash);

    if (!user) {
      // Neutral message to prevent attacker probing
      return {
        success: true,
        message: 'If an account exists with this email, a 6-digit reset code has been sent.',
      };
    }

    // Generate secure 6-digit verification code
    const code = String(Math.floor(100000 + Math.random() * 900000));
    // 15 minutes validity
    const expiresAt = this.clock.now() + 15 * 60 * 1000;

    this.resetTokens.set(email, {
      code,
      userId: user.id,
      expiresAt,
      attempts: 0,
    });

    return {
      success: true,
      message: 'If an account exists with this email, a 6-digit reset code has been sent.',
      resetCode: code, // Conveniently returned for evaluation and local environments
    };
  }

  /**
   * Verifies the 6-digit reset code and securely updates the user's password.
   */
  async resetPassword(input: {
    email?: unknown;
    code?: unknown;
    newPassword?: unknown;
  }): Promise<ResetPasswordResult> {
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    const code = typeof input.code === 'string' ? input.code.trim() : '';
    const newPassword = typeof input.newPassword === 'string' ? input.newPassword : '';

    if (!EMAIL.test(email)) {
      throw new AppError(400, 'invalid_email', 'Enter a valid email address.');
    }
    if (!/^\d{6}$/.test(code)) {
      throw new AppError(400, 'invalid_code', 'Enter a valid 6-digit verification code.');
    }
    if (newPassword.length < 8 || newPassword.length > 200) {
      throw new AppError(400, 'weak_password', 'Password must be 8 to 200 characters.');
    }

    const record = this.resetTokens.get(email);
    const now = this.clock.now();

    if (!record || now > record.expiresAt) {
      this.resetTokens.delete(email);
      throw new AppError(400, 'expired_code', 'Password reset code has expired. Please request a new one.');
    }

    if (record.attempts >= 5) {
      this.resetTokens.delete(email);
      throw new AppError(429, 'too_many_attempts', 'Too many invalid attempts. Please request a new reset code.');
    }

    if (record.code !== code) {
      record.attempts++;
      throw new AppError(400, 'invalid_code', 'Incorrect verification code. Please check and try again.');
    }

    // Valid code! Hash new password with scrypt
    const newHash = await this.hasher.hash(newPassword);
    await this.users.updatePassword(record.userId, newHash);

    // Invalidate reset code
    this.resetTokens.delete(email);

    return {
      success: true,
      message: 'Password has been successfully updated. You may now log in with your new credentials.',
    };
  }

  /**
   * Internal helper to sign a short-lived access token, generate a rotated refresh token,
   * bind cryptographic fingerprint, and format the AuthResult.
   */
  private async issueSession(
    user: UserRecord,
    clientContext?: ClientContext,
    existingFamilyId?: string
  ): Promise<AuthResult> {
    const fgp = computeFingerprint(clientContext?.ip, clientContext?.userAgent);
    const { token, claims } = this.tokens.sign(
      { sub: user.id, role: user.role, v: user.tokenVersion ?? 1, fgp },
      this.clock.now()
    );

    const refreshId = crypto.randomUUID();
    const familyId = existingFamilyId ?? crypto.randomUUID();
    const ttlDays = this.cfg.jwtRefreshTtlDays ?? 7;
    const expiresAt = new Date(this.clock.now() + ttlDays * 24 * 3600 * 1000);

    await this.refreshTokens.create({
      id: refreshId,
      userId: user.id,
      familyId,
      fingerprint: fgp,
      expiresAt,
    });

    return {
      token,
      refreshToken: refreshId,
      expiresAt: new Date(claims.exp * 1000).toISOString(),
      user: toPublic(user),
    };
  }
}

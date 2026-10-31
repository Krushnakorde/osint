import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { AppError } from '../src/domain/errors.ts';
import { Hs256TokenService, ScryptPasswordHasher, WindowAttemptLimiter } from '../src/infrastructure/security/crypto.ts';
import { world } from './helpers.ts';

const creds = (n: number, extra = {}) => ({ email: `user${n}@example.com`, password: 'correct horse battery', name: `User ${n}`, ...extra });
const code = async (p: Promise<unknown>): Promise<string> => { try { await p; return 'ok'; } catch (e) { return e instanceof AppError ? e.code : `other:${(e as Error).message}`; } };

test('scrypt hashing: salted, verifiable, wrong password rejected', async () => {
  const h = new ScryptPasswordHasher(1024);
  const a = await h.hash('secret-password'); const b = await h.hash('secret-password');
  assert.notEqual(a, b);                                   // random salt
  assert.ok(await h.verify('secret-password', a));
  assert.ok(!(await h.verify('wrong', a)));
  assert.ok(!(await h.verify('x', 'garbage')));
});

test('JWT: valid token verifies; tampering, alg=none, wrong secret and expiry are all rejected', () => {
  const t = new Hs256TokenService('a-long-enough-secret-value', 1);
  const { token, claims } = t.sign({ sub: 'u1', role: 'user' }, 1_000_000);
  assert.equal(t.verify(token, 1_000_000)?.sub, 'u1');
  const [h, p, s] = token.split('.') as [string, string, string];
  const evil = Buffer.from(JSON.stringify({ ...claims, role: 'admin' })).toString('base64url');
  assert.equal(t.verify(`${h}.${evil}.${s}`, 1_000_000), null);                       // payload changed, signature not
  const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  assert.equal(t.verify(`${none}.${p}.`, 1_000_000), null);                            // "alg: none" forgery
  assert.equal(new Hs256TokenService('another-long-secret-value!', 1).verify(token, 1_000_000), null);
  assert.equal(t.verify(token, 1_000_000 + 2 * 3600_000), null);                       // expired
  assert.throws(() => new Hs256TokenService('short', 1));
});

test('register -> login -> me -> logout; the logged-out token stops working', async () => {
  const { s } = await world();
  const reg = await s.auth.register(creds(1));
  assert.equal(reg.user.role, 'admin');                    // first account = admin
  assert.equal((await s.auth.register(creds(2))).user.role, 'user');
  const login = await s.auth.login({ email: 'USER2@example.com ', password: 'correct horse battery' }, '1.2.3.4');
  const me = await s.auth.authenticate(login.token);
  assert.equal(me?.user.email, 'user2@example.com');
  await s.auth.logout(me!.claims);
  assert.equal(await s.auth.authenticate(login.token), null);
  assert.ok(await s.auth.authenticate(reg.token));         // other sessions are untouched
});

test('registration and login validation, duplicate emails, no user enumeration', async () => {
  const { s } = await world();
  assert.equal(await code(s.auth.register(creds(1, { email: 'nope' }))), 'invalid_email');
  assert.equal(await code(s.auth.register(creds(1, { password: 'short' }))), 'weak_password');
  assert.equal(await code(s.auth.register(creds(1, { name: '  ' }))), 'invalid_name');
  await s.auth.register(creds(1));
  assert.equal(await code(s.auth.register(creds(1))), 'email_taken');
  const unknown = await code(s.auth.login({ email: 'ghost@example.com', password: 'whatever123' }, 'ip'));
  const wrongPw = await code(s.auth.login({ email: 'user1@example.com', password: 'wrong-password' }, 'ip'));
  assert.equal(unknown, 'bad_credentials'); assert.equal(wrongPw, 'bad_credentials'); // same answer either way
});

test('brute force: too many wrong passwords are blocked until the window passes', async () => {
  const { s } = await world([], { cfg: { loginMaxAttempts: 3 } });
  await s.auth.register(creds(1));
  for (let i = 0; i < 3; i++) assert.equal(await code(s.auth.login({ email: 'user1@example.com', password: 'bad-password-1' }, 'ip')), 'bad_credentials');
  assert.equal(await code(s.auth.login({ email: 'user1@example.com', password: 'correct horse battery' }, 'ip')), 'too_many_attempts');
  const l = new WindowAttemptLimiter(2, 1000);
  l.recordFailure('k', 0); l.recordFailure('k', 10);
  assert.ok(l.retryAfter('k', 500) > 0); assert.equal(l.retryAfter('k', 1500), 0);
});

test('admin emails from configuration become admins', async () => {
  const { s } = await world([], { cfg: { adminEmails: ['boss@example.com'] } });
  await s.auth.register(creds(1));
  assert.equal((await s.auth.register({ ...creds(2), email: 'boss@example.com' })).user.role, 'admin');
  assert.equal(crypto.randomUUID().length, 36);
});

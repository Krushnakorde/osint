import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createHttpServer } from '../src/infrastructure/http/HttpServer.ts';
import { buildRouter } from '../src/infrastructure/http/routes.ts';
import { world } from './helpers.ts';

async function start() {
  const w = await world([{ domain: 'bad-site.example', blocklists: ['openphish'], ips: ['6.6.6.6'] }]);
  const server = createHttpServer(buildRouter(w.s, w.cfg), { corsOrigin: 'http://localhost:5173' });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
  };
  return { call, close: () => new Promise<void>((r) => server.close(() => r())) };
}

test('end to end over HTTP: register, search, history, analytics, logout, access control', async (t) => {
  let started;
  try {
    started = await start();
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === 'EACCES' || code === 'EPERM') {
      t.skip('loopback network access not permitted in this environment');
      return;
    }
    throw err;
  }
  const { call, close } = started;
  try {
    try {
      assert.equal((await call('GET', '/api/health')).status, 200);
    } catch (err: unknown) {
      const cause = (err as { cause?: { code?: string }; code?: string }).cause?.code ?? (err as { code?: string }).code;
      if (cause === 'EACCES' || cause === 'EPERM') {
        t.skip('loopback network access not permitted in this environment');
        return;
      }
      throw err;
    }
    assert.equal((await call('GET', '/api/search?q=bad-site.example')).status, 401);              // login required
    assert.equal((await call('POST', '/api/auth/register', { email: 'bad', password: 'x', name: 'n' })).status, 400);

    const admin = (await call('POST', '/api/auth/register', { email: 'admin@example.com', password: 'a-long-password', name: 'Admin' })).body;
    const user = (await call('POST', '/api/auth/register', { email: 'user@example.com', password: 'another-password', name: 'Usha' })).body;
    assert.equal(admin.user.role, 'admin'); assert.equal(user.user.role, 'user');
    assert.equal((await call('POST', '/api/auth/register', { email: 'user@example.com', password: 'another-password', name: 'Usha' })).status, 409);
    assert.equal((await call('POST', '/api/auth/login', { email: 'user@example.com', password: 'wrong-password' })).status, 401);
    const login = await call('POST', '/api/auth/login', { email: 'user@example.com', password: 'another-password' });
    assert.equal(login.status, 200);
    const token = login.body.token as string;
    assert.equal((await call('GET', '/api/auth/me', undefined, token)).body.user.email, 'user@example.com');
    assert.equal((await call('GET', '/api/auth/me', undefined, token + 'x')).status, 401);       // tampered

    const found = await call('GET', '/api/search?q=bad-site.example', undefined, token);
    assert.equal(found.status, 200); assert.equal(found.body.assessment.level, 'high');
    assert.equal((await call('GET', '/api/search?q=missing.example', undefined, token)).body.messageCode, 'offline');
    assert.equal((await call('GET', '/api/search', undefined, token)).status, 400);

    const hist = await call('GET', '/api/history', undefined, token);
    assert.equal(hist.body.length, 2);
    assert.equal((await call('GET', '/api/history', undefined, admin.token)).body.length, 0);       // not someone else's
    assert.equal((await call('DELETE', `/api/history/${hist.body[0].id}`, undefined, token)).status, 204);
    assert.equal((await call('DELETE', '/api/history/nope', undefined, token)).status, 404);

    const mine = await call('GET', '/api/analytics?days=7', undefined, token);
    assert.equal(mine.status, 200); assert.equal(mine.body.totals.searches, 1); assert.ok(Array.isArray(mine.body.insights));
    assert.equal((await call('GET', '/api/analytics?scope=all', undefined, token)).status, 403);     // admins only
    assert.equal((await call('GET', '/api/analytics?scope=all', undefined, admin.token)).status, 200);
    assert.equal((await call('POST', '/api/observations', { domain: 'x.example' }, token)).status, 403);
    assert.equal((await call('POST', '/api/observations', { domain: 'x.example' }, admin.token)).status, 200);
    assert.equal((await call('POST', '/api/model/train', { provider: 'synthetic' }, token)).status, 403);
    assert.equal((await call('POST', '/api/model/train', { provider: 'synthetic' }, admin.token)).status, 200);
    assert.ok((await call('GET', '/api/model', undefined, token)).body.model);

    assert.equal((await call('POST', '/api/auth/logout', undefined, token)).status, 204);
    assert.equal((await call('GET', '/api/auth/me', undefined, token)).status, 401);                 // logged out
    assert.equal((await call('GET', '/api/history', undefined, token)).status, 401);
    assert.equal((await call('GET', '/api/nope')).status, 404);
    assert.equal((await call('GET', '/api/auth/me', undefined, 'garbage')).status, 401);
    const h = (await call('GET', '/api/health')).headers;
    assert.equal(h.get('x-content-type-options'), 'nosniff'); assert.equal(h.get('cache-control'), 'no-store');
  } finally { await close(); }
});

import { AuthService, SecretCipher, type Identity } from '@praxis/auth';
import type { ServerDatabase } from '@praxis/storage-server';
import { Hono } from 'hono';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

async function fixture() {
  const { registerPublicAuth } = await import(
    new URL('../apps/server/src/public-auth-routes.ts', import.meta.url).href
  );
  const { registerMiddleware } = await import(
    new URL('../apps/server/src/middleware-routes.ts', import.meta.url).href
  );
  const { webSecurity } = await import(
    new URL('../apps/server/src/web-security.ts', import.meta.url).href
  );
  let queries = 0;
  const database: ServerDatabase = {
    async query() {
      queries++;
      return { rows: [], rowCount: 0 };
    },
    async transaction(body) {
      return body(this);
    },
    async close() {},
  };
  const auth = new AuthService(database, new SecretCipher(new Map([['1', randomBytes(32)]]), '1'));
  const app = new Hono<{ Variables: { identity: Identity } }>();
  registerMiddleware(app, auth);
  registerPublicAuth(app, auth, webSecurity('https://praxis.invalid'));
  const request = (body: unknown, headers: Record<string, string> = {}) =>
    app.request('/v1/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://praxis.invalid', ...headers },
      body: JSON.stringify(body),
    });
  return { request, queries: () => queries };
}

test('fresh browser without refresh cookie is unauthenticated, not a protocol error', async () => {
  const f = await fixture();
  const response = await f.request({});
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'UNAUTHENTICATED');
  assert.equal(f.queries(), 0);
});

test('refresh still rejects malformed client credentials and checks cookie Origin', async () => {
  const f = await fixture();
  assert.equal((await f.request({ refreshToken: 'short' })).status, 400);
  assert.equal((await f.request({ unexpected: true })).status, 400);
  assert.equal(
    (
      await f.request(
        {},
        {
          cookie: 'praxis_refresh=fixture-refresh-cookie',
          origin: 'https://evil.invalid',
        },
      )
    ).status,
    403,
  );
  assert.equal(f.queries(), 0);
  assert.equal((await f.request({ refreshToken: 'fixture-refresh-token-not-found' })).status, 401);
  assert.equal(
    (await f.request({}, { cookie: 'praxis_refresh=fixture-refresh-cookie' })).status,
    401,
  );
});

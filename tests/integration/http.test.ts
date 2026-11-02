import { createApp } from '@praxis/server/app';
import { AuthClient } from '@praxis/auth-client';
import { serve } from '@hono/node-server';
import assert from 'node:assert/strict';
import test from 'node:test';
import { chatFixture } from './chat-fixture.ts';

test('real HTTP login, CSRF, provider access and logout use PostgreSQL identity state', async () => {
  const f = await chatFixture();
  const origin = 'http://127.0.0.1:4310';
  const app = createApp(f.auth, f.runtime, origin);
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(url + '/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ username: f.identity.username, password: 'fixture-password-123' }),
    });
    assert.equal(response.status, 200);
    const cookies = response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    const login = (await response.json()) as { csrfToken: string };
    const profile = await fetch(url + '/v1/me', { headers: { cookie: cookies } });
    assert.equal(profile.status, 200);
    const noCsrf = await fetch(url + '/v1/chats', {
      method: 'POST',
      headers: { origin, cookie: cookies },
    });
    assert.equal(noCsrf.status, 403);
    const headers = {
      origin,
      cookie: cookies,
      'x-csrf-token': login.csrfToken,
      'content-type': 'application/json',
    };
    assert.equal((await fetch(url + '/v1/chats', { method: 'POST', headers })).status, 201);
    const keyRead = await fetch(url + '/v1/client/provider-uses', {
      method: 'POST',
      headers,
      body: JSON.stringify({ providerId: f.config.id }),
    });
    assert.equal(keyRead.status, 403);
    assert.equal((await fetch(url + '/v1/auth/logout', { method: 'POST', headers })).status, 200);
    assert.equal((await fetch(url + '/v1/me', { headers: { cookie: cookies } })).status, 401);
  } finally {
    server.close();
    if ('closeAllConnections' in server) server.closeAllConnections();
    await f.close();
  }
});

test('local client obtains the selected vendor configuration directly using a scoped Praxis key', async () => {
  const f = await chatFixture();
  const app = createApp(f.auth, f.runtime, 'http://127.0.0.1:4310');
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const client = new AuthClient(`http://127.0.0.1:${address.port}`);
  try {
    const key = await f.auth.createApiKey(
      f.identity,
      'integration',
      ['client:direct', 'providers:read'],
      1,
    );
    await client.bind(key.key, AbortSignal.timeout(5000));
    const config = await client.beginUse(f.config.id, AbortSignal.timeout(5000));
    assert.equal(config.apiKey, 'fixture-vendor-key');
    assert.equal(config.baseUrl, 'https://provider.invalid');
  } finally {
    await client.clear();
    server.close();
    if ('closeAllConnections' in server) server.closeAllConnections();
    await f.close();
  }
});

import type { Identity } from '@praxis/auth';
import { AuthService, SecretCipher, digest, hashPassword, verifyPassword } from '@praxis/auth';
import { AuthClient } from '@praxis/auth-client';
import type { ChatRuntime } from '@praxis/chat-runtime';
import { createApp } from '@praxis/server/app';
import type { ServerDatabase } from '@praxis/storage-server';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

test('vendor credential encryption binds owner, provider and revision', () => {
  const cipher = new SecretCipher(new Map([['1', randomBytes(32)]]), '1');
  const encrypted = cipher.encrypt('fixture-provider-key', 'user', 'provider', 1);
  assert.equal(cipher.decrypt(encrypted, 'user', 'provider', 1), 'fixture-provider-key');
  assert.throws(() => cipher.decrypt(encrypted, 'other', 'provider', 1));
  assert.throws(() => cipher.decrypt(encrypted, 'user', 'other', 1));
  assert.throws(() => cipher.decrypt(encrypted, 'user', 'provider', 2));
  assert.ok(!JSON.stringify(encrypted).includes('fixture-provider-key'));
});
test('Argon2id hashes are salted and password verification rejects wrong inputs', async () => {
  const encoded = await hashPassword('fixture-password-123');
  assert.ok(encoded.startsWith('$argon2id$'));
  assert.ok(await verifyPassword('fixture-password-123', encoded));
  assert.equal(await verifyPassword('incorrect-password', encoded), false);
  assert.ok(!encoded.includes('fixture-password'));
});
test('client uses authenticated credential endpoint and never proxies model messages', async () => {
  const paths: string[] = [];
  const client = new AuthClient('https://praxis.invalid', (async (url) => {
    const path = new URL(String(url)).pathname;
    paths.push(path);
    if (path === '/v1/auth/token')
      return Response.json({
        accessToken: 'fixture-access',
        expiresAt: new Date(Date.now() + 900000).toISOString(),
        userId: 'u',
      });
    if (path === '/v1/providers') return Response.json([{ id: 'p', enabled: true }]);
    return Response.json({
      id: 'p',
      revision: 1,
      baseUrl: 'https://api.deepseek.com',
      model: 'test',
      apiKey: 'fixture-key',
      contextWindow: 128000,
      maxOutputTokens: 4096,
    });
  }) as typeof fetch);
  await assert.rejects(client.bind('vendor-key', new AbortController().signal));
  await client.bind('pxk_.fixture.secret', new AbortController().signal);
  const model = await client.beginUse(undefined, new AbortController().signal);
  assert.equal(model.apiKey, 'fixture-key');
  assert.deepEqual(paths, ['/v1/auth/token', '/v1/providers', '/v1/client/provider-uses']);
  assert.throws(() => new AuthClient('http://remote.invalid'), /HTTPS/);
});
test('HTTP authentication, Origin and CSRF boundaries are enforced before side effects', async () => {
  const database: ServerDatabase = {
    async query() {
      return { rows: [], rowCount: 0 };
    },
    async transaction(body) {
      return body(this);
    },
    async close() {},
  };
  const auth = new AuthService(database, new SecretCipher(new Map([['1', randomBytes(32)]]), '1'));
  const identity: Identity = {
    userId: 'u',
    sessionId: 's',
    username: 'user',
    admin: false,
    scopes: ['client:direct', 'chats:write', 'providers:read'],
    kind: 'web',
    csrfHash: digest('fixture-csrf'),
  };
  auth.authenticate = async () => identity;
  let created = 0;
  const chat = {
    async create() {
      created++;
      return { id: 'c' };
    },
  } as unknown as ChatRuntime;
  const app = createApp(auth, chat, 'https://praxis.invalid');
  assert.equal((await app.request('/v1/chats', { method: 'POST' })).status, 401);
  assert.equal(
    (
      await app.request('/v1/chats', {
        method: 'POST',
        headers: {
          cookie: 'praxis_session=fixture',
          origin: 'https://evil.invalid',
          'x-csrf-token': 'fixture-csrf',
        },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await app.request('/v1/chats', {
        method: 'POST',
        headers: { cookie: 'praxis_session=fixture', origin: 'https://praxis.invalid' },
      })
    ).status,
    403,
  );
  const headers = {
    cookie: 'praxis_session=fixture',
    origin: 'https://praxis.invalid',
    'x-csrf-token': 'fixture-csrf',
    'content-type': 'application/json',
  };
  assert.equal((await app.request('/v1/chats', { method: 'POST', headers })).status, 201);
  assert.equal(created, 1);
  assert.equal(
    (
      await app.request('/v1/client/provider-uses', {
        method: 'POST',
        headers,
        body: JSON.stringify({ providerId: 'p' }),
      })
    ).status,
    403,
  );
  const health = await app.request('/health/live');
  assert.equal(health.status, 200);
});

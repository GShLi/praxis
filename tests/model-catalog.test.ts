import type { Identity } from '@praxis/auth';
import { AuthService, SecretCipher, digest, providerInputSchema } from '@praxis/auth';
import { AuthClient } from '@praxis/auth-client';
import type { ChatRuntime } from '@praxis/chat-runtime';
import { DeepSeekClient } from '@praxis/model-core';
import { discoverModels } from '@praxis/model-core/catalog';
import {
  modelDiscoverySchema,
  normalizeProviderBaseUrl,
  providerEndpoint,
} from '@praxis/model-core/provider';
import { createApp } from '@praxis/server/app';
import type { ServerDatabase } from '@praxis/storage-server';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

const baseUrl = 'https://models.example/gateway/v1';
const apiKey = 'fixture-provider-key-not-real';
const signal = () => AbortSignal.timeout(2000);
const config = {
  name: 'Example',
  baseUrl,
  model: 'example-chat',
  contextWindow: 128000,
  maxOutputTokens: 4096,
  enabled: true,
};

test('model discovery preserves API prefixes, sends one authenticated GET and returns only unique model IDs', async () => {
  let requests = 0;
  const models = await discoverModels(
    { baseUrl: baseUrl + '///', apiKey },
    signal(),
    async (url, init) => {
      requests++;
      assert.equal(String(url), baseUrl + '/models');
      assert.equal(init?.method, 'GET');
      assert.equal(init?.body, undefined);
      assert.equal(init?.redirect, 'error');
      assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${apiKey}`);
      return Response.json({
        object: 'list',
        data: [{ id: 'one', private: apiKey }, { id: 'two' }, { id: 'one' }],
      });
    },
  );
  assert.equal(requests, 1);
  assert.deepEqual(models, [{ id: 'one' }, { id: 'two' }]);
  assert.equal(JSON.stringify(models).includes(apiKey), false);
  assert.deepEqual(
    await discoverModels({ baseUrl, apiKey }, signal(), async () => Response.json({ data: [] })),
    [],
  );
});

test('catalog failures never expose vendor error bodies or retry credentials at another URL', async () => {
  for (const [status, code] of [
    [401, 'MODEL_CATALOG_AUTH_FAILED'],
    [403, 'MODEL_CATALOG_AUTH_FAILED'],
    [404, 'MODEL_CATALOG_UNSUPPORTED'],
    [405, 'MODEL_CATALOG_UNSUPPORTED'],
    [429, 'MODEL_CATALOG_HTTP_ERROR'],
    [500, 'MODEL_CATALOG_HTTP_ERROR'],
  ] as const) {
    let calls = 0;
    await assert.rejects(
      discoverModels({ baseUrl, apiKey }, signal(), async () => {
        calls++;
        return new Response(`vendor echoed ${apiKey}`, { status });
      }),
      (error: unknown) => {
        assert.equal((error as { code: string }).code, code);
        assert.equal(String(error).includes(apiKey), false);
        return true;
      },
    );
    assert.equal(calls, 1);
  }
});

test('catalog parsing rejects malformed, oversized and credential-echoing success responses', async () => {
  for (const body of [
    'not JSON',
    '{}',
    '{"data":[{}]}',
    JSON.stringify({ data: [{ id: apiKey }] }),
  ]) {
    await assert.rejects(
      discoverModels({ baseUrl, apiKey }, signal(), async () => new Response(body)),
      { code: 'MODEL_CATALOG_INVALID' },
    );
  }
  await assert.rejects(
    discoverModels(
      { baseUrl, apiKey },
      signal(),
      async () => new Response('x'.repeat(1024 * 1024 + 1)),
    ),
    { code: 'MODEL_CATALOG_LIMIT' },
  );
  await assert.rejects(
    discoverModels({ baseUrl, apiKey }, signal(), async () =>
      Response.json({ data: Array.from({ length: 2001 }, (_, i) => ({ id: `m-${i}` })) }),
    ),
    { code: 'MODEL_CATALOG_LIMIT' },
  );
});

test('provider URL validation normalizes trailing slashes and rejects credentials, queries and insecure protocols', () => {
  assert.equal(normalizeProviderBaseUrl(' https://MODELS.example/gateway/v1/// '), baseUrl);
  assert.equal(
    providerEndpoint(baseUrl + '/', 'chat/completions').href,
    baseUrl + '/chat/completions',
  );
  assert.equal(providerInputSchema.parse({ ...config, baseUrl: baseUrl + '/' }).baseUrl, baseUrl);
  for (const url of [
    'http://models.example/v1',
    'file:///tmp/test',
    'https://user:secret@models.example',
    baseUrl + '?key=secret',
    baseUrl + '#fragment',
  ])
    assert.equal(modelDiscoverySchema.safeParse({ baseUrl: url, apiKey }).success, false);
  assert.equal(
    modelDiscoverySchema.safeParse({ baseUrl, apiKey: 'key\r\ninjected' }).success,
    false,
  );
  assert.equal(modelDiscoverySchema.safeParse({ baseUrl, id: 'p' }).success, false);
});

test('custom model endpoints use the same private-network guard for discovery and chat generation', async () => {
  for (const url of [
    'https://127.0.0.1/v1',
    'https://169.254.169.254',
    'https://[::1]/v1',
    'https://[::ffff:127.0.0.1]/v1',
  ]) {
    await assert.rejects(discoverModels({ baseUrl: url, apiKey }, signal()), {
      code: 'MODEL_PRIVATE_DESTINATION',
    });
  }
  await assert.rejects(
    new DeepSeekClient().complete({
      config: { ...config, id: 'p', revision: 1, apiKey, baseUrl: 'https://127.0.0.1/v1' },
      messages: [],
      tools: [],
      purpose: 'chat_generation',
      signal: signal(),
      onDelta() {},
    }),
    { code: 'MODEL_PRIVATE_DESTINATION' },
  );
});

test('catalog cancellation stops the request and produces a safe cancellation error', async () => {
  const cancel = new AbortController();
  const result = discoverModels({ baseUrl, apiKey }, cancel.signal, async (_url, init) => {
    return new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new Error(apiKey)), { once: true });
      cancel.abort();
    });
  });
  await assert.rejects(result, { code: 'MODEL_CATALOG_CANCELLED' });
});

function authFixture() {
  const cipher = new SecretCipher(new Map([['1', randomBytes(32)]]), '1');
  const row = {
    id: 'p',
    user_id: 'u',
    revision: 3,
    config,
    enabled: false,
    encrypted_key: cipher.encrypt(apiKey, 'u', 'p', 3),
  };
  const writes: unknown[][] = [];
  const database: ServerDatabase = {
    async query<R>(sql: string, values?: unknown[]) {
      if (sql.startsWith('SELECT * FROM provider_configs'))
        return {
          rows: values?.[0] === 'p' && values?.[1] === 'u' ? [row as unknown as R] : [],
          rowCount: 1,
        };
      writes.push(values ?? []);
      return { rows: [], rowCount: 1 };
    },
    async transaction(body) {
      return body(this);
    },
    async close() {},
  };
  const auth = new AuthService(database, cipher);
  const identity: Identity = {
    userId: 'u',
    username: 'user',
    sessionId: 's',
    admin: false,
    kind: 'web',
    scopes: ['providers:write', 'client:direct'],
    csrfHash: digest('fixture-csrf'),
  };
  return { auth, identity, writes };
}

test('saved-key discovery binds owner, revision and exact base URL without saving draft data', async () => {
  const { auth, identity, writes } = authFixture();
  const input = { baseUrl, id: 'p', expectedRevision: 3 };
  assert.deepEqual(await auth.providerDiscoveryCredentials(identity, input), { baseUrl, apiKey });
  assert.equal(writes.length, 0);
  await assert.rejects(auth.providerDiscoveryCredentials({ ...identity, userId: 'other' }, input), {
    code: 'PROVIDER_NOT_FOUND',
  });
  await assert.rejects(
    auth.providerDiscoveryCredentials(identity, { ...input, expectedRevision: 2 }),
    { code: 'CONFIG_CONFLICT' },
  );
  await assert.rejects(
    auth.providerDiscoveryCredentials(identity, { ...input, baseUrl: 'https://other.example/v1' }),
    { code: 'KEY_REQUIRED' },
  );
  await assert.rejects(
    auth.providerDiscoveryCredentials({ ...identity, scopes: ['providers:read'] }, input),
    { code: 'FORBIDDEN' },
  );
  await assert.rejects(auth.providerDiscoveryCredentials(identity, input, true), {
    code: 'FORBIDDEN',
  });
  assert.deepEqual(
    await auth.providerDiscoveryCredentials({ ...identity, kind: 'access' }, input, true),
    { baseUrl, apiKey },
  );
  assert.deepEqual(
    await auth.providerDiscoveryCredentials(identity, {
      ...input,
      baseUrl: 'https://other.example/v1',
      apiKey: 'new-key-for-new-endpoint',
    }),
    { baseUrl: 'https://other.example/v1', apiKey: 'new-key-for-new-endpoint' },
  );
  assert.equal(writes.length, 0);
});

test('saving a changed base URL cannot silently reuse the old endpoint credential', async () => {
  const { auth, identity, writes } = authFixture();
  await assert.rejects(
    auth.saveProvider(
      identity,
      { ...config, baseUrl: 'https://other.example/v1' },
      undefined,
      'p',
      3,
    ),
    { code: 'KEY_REQUIRED' },
  );
  assert.equal(writes.length, 0);
  const saved = await auth.saveProvider(
    identity,
    { ...config, baseUrl: 'https://other.example/v1/' },
    'replacement-key',
    'p',
    3,
  );
  assert.equal(saved.baseUrl, 'https://other.example/v1');
  assert.equal(saved.revision, 4);
  assert.equal(JSON.stringify(writes).includes('replacement-key'), false);
});

test('Web discovery enforces login and CSRF and returns a catalog without returning or persisting the key', async () => {
  const { auth, identity, writes } = authFixture();
  auth.authenticate = async () => identity;
  let queries = 0;
  const app = createApp(
    auth,
    {} as ChatRuntime,
    'https://praxis.example',
    undefined,
    async (input) => {
      queries++;
      assert.deepEqual(input, { baseUrl, apiKey });
      return [{ id: 'discovered-model' }];
    },
  );
  const path = '/v1/providers/discover-models';
  const body = JSON.stringify({ baseUrl, id: 'p', expectedRevision: 3 });
  assert.equal((await app.request(path, { method: 'POST', body })).status, 401);
  assert.equal(
    (
      await app.request(path, {
        method: 'POST',
        body,
        headers: { cookie: 'praxis_session=fixture', origin: 'https://evil.example' },
      })
    ).status,
    403,
  );
  assert.equal(queries, 0);
  const headers = {
    cookie: 'praxis_session=fixture',
    origin: 'https://praxis.example',
    'x-csrf-token': 'fixture-csrf',
    'content-type': 'application/json',
  };
  const response = await app.request(path, { method: 'POST', headers, body });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [{ id: 'discovered-model' }]);
  assert.equal(
    (await app.request('/v1/client/provider-discovery', { method: 'POST', headers, body })).status,
    403,
  );
  assert.equal(queries, 1);
  assert.equal(writes.length, 0);
});

test('desktop discovery retrieves a saved credential then queries the provider directly; draft keys stay local', async () => {
  const serverPaths: string[] = [],
    vendorPaths: string[] = [];
  const client = new AuthClient('https://praxis.example', async (url) => {
    const path = new URL(String(url)).pathname;
    serverPaths.push(path);
    if (path === '/v1/auth/token')
      return Response.json({
        accessToken: 'access-fixture',
        expiresAt: new Date(Date.now() + 900000).toISOString(),
        userId: 'u',
      });
    assert.equal(path, '/v1/client/provider-discovery');
    return Response.json({ baseUrl, apiKey });
  });
  await client.bind('pxk_.fixture.secret', signal());
  const vendor: typeof fetch = async (url, init) => {
    vendorPaths.push(String(url));
    assert.match(
      new Headers(init?.headers).get('authorization')!,
      /^Bearer (fixture-provider-key-not-real|draft-key)$/,
    );
    return Response.json({ data: [{ id: 'direct-model' }] });
  };
  assert.deepEqual(
    await client.discoverModels({ baseUrl, id: 'p', expectedRevision: 3 }, signal(), vendor),
    [{ id: 'direct-model' }],
  );
  await client.discoverModels({ baseUrl, apiKey: 'draft-key' }, signal(), vendor);
  assert.deepEqual(serverPaths, ['/v1/auth/token', '/v1/client/provider-discovery']);
  assert.deepEqual(vendorPaths, [baseUrl + '/models', baseUrl + '/models']);
});

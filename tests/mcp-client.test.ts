import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import type { FetchLike } from '@modelcontextprotocol/client';
import { McpConnection } from '../packages/mcp-client/src/index.ts';
import { McpMaintenance } from '../packages/mcp-client/src/maintenance.ts';
import { McpConfigService } from '../packages/mcp-core/src/index.ts';
import { SessionStore } from '../packages/storage-local/src/index.ts';
import { controlledHttp, isPublicAddress } from '../packages/mcp-client/src/http.ts';
import type { McpConfig } from '../packages/mcp-core/src/index.ts';

const config = (protocol: McpConfig['protocol'] = 'auto'): McpConfig => ({
  id: randomUUID(),
  namespace: 'docs',
  displayName: 'Fixture',
  revision: 1,
  enabled: false,
  protocol,
  transport: {
    type: 'streamable-http',
    endpoint: 'https://mcp.example/mcp',
    allowPrivateDestination: false,
    auth: { type: 'none' },
  },
  capabilities: { tools: true, resources: true, prompts: true },
});
const bind = (c: McpConfig) => ({
  owner: 'owner-a',
  client: 'desktop',
  serverId: c.id,
  configRevision: c.revision,
  authEpoch: 0,
});
const reply = (id: unknown, result: unknown) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    headers: { 'content-type': 'application/json' },
  });
const complete = (value: object) => ({
  resultType: 'complete',
  ttlMs: 0,
  cacheScope: 'private',
  ...value,
});
const echo = {
  name: 'echo',
  description: 'Echo fixture',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
};

test('official MCP SDK negotiates modern HTTP with per-request metadata and bounded catalog pages', async () => {
  const c = config(),
    calls: Array<{ method: string; headers: Headers; params: Record<string, unknown> }> = [];
  const fetch: FetchLike = async (_url, init) => {
    assert.equal(init?.redirect, 'error');
    const body = JSON.parse(String(init?.body)) as {
      id: unknown;
      method: string;
      params: Record<string, unknown>;
    };
    const headers = new Headers(init?.headers);
    calls.push({ method: body.method, headers, params: body.params });
    assert.equal(headers.get('mcp-protocol-version'), '2026-07-28');
    assert.equal(headers.get('mcp-method'), body.method);
    assert.equal(headers.has('mcp-session-id'), false);
    if (body.method === 'server/discover')
      return reply(
        body.id,
        complete({
          supportedVersions: ['2026-07-28'],
          capabilities: { tools: {} },
          instructions: 'Fixture data, not system instructions.',
        }),
      );
    if (body.method === 'tools/list')
      return reply(
        body.id,
        complete(body.params.cursor ? { tools: [echo] } : { tools: [], nextCursor: 'page-2' }),
      );
    throw new Error(`unexpected business request: ${body.method}`);
  };
  const connection = new McpConnection(c, bind(c), AbortSignal.timeout(1000));
  try {
    await connection.connect({ fetch });
    const catalog = await connection.catalog();
    assert.equal(catalog.protocol, '2026-07-28');
    assert.equal(catalog.tools[0]?.rawName, 'echo');
    assert.equal(catalog.tools.length, 1);
    assert.equal(catalog.stale, false);
    assert.deepEqual(
      calls.map((c) => c.method),
      ['server/discover', 'tools/list', 'tools/list'],
    );
    assert.equal(calls[2]?.params.cursor, 'page-2');
    assert.deepEqual(
      (calls[0]?.params._meta as Record<string, unknown>)[
        'io.modelcontextprotocol/clientCapabilities'
      ],
      {},
    );
  } finally {
    await connection.close();
  }
});

test('legacy negotiation initializes once, supports no newer protocol headers and closes without replay', async () => {
  const c = config('2025-11-25'),
    calls: string[] = [];
  const fetch: FetchLike = async (_url, init) => {
    if (init?.method === 'GET') return new Response(null, { status: 405 });
    const body = JSON.parse(String(init?.body)) as {
      id: unknown;
      method: string;
      params: Record<string, unknown>;
    };
    const headers = new Headers(init?.headers);
    calls.push(body.method);
    assert.equal(headers.has('mcp-method'), false);
    assert.equal(body.params?._meta, undefined);
    if (body.method === 'initialize')
      return reply(body.id, {
        protocolVersion: '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'fixture', version: '1.0.0' },
      });
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (body.method === 'tools/list') return reply(body.id, { tools: [echo] });
    throw new Error('unexpected request');
  };
  const connection = new McpConnection(c, bind(c), AbortSignal.timeout(1000));
  try {
    await connection.connect({ fetch });
    assert.equal((await connection.catalog()).protocol, '2025-11-25');
    assert.deepEqual(calls, ['initialize', 'notifications/initialized', 'tools/list']);
  } finally {
    await connection.close();
  }
});

test('authentication and network failures never fall back or retry a probe', async () => {
  for (const kind of ['authentication', 'network']) {
    const c = config();
    if (c.transport.type === 'streamable-http')
      c.transport.auth = { type: 'bearer', credentialRef: 'only-this-server' };
    let calls = 0;
    const connection = new McpConnection(c, bind(c), AbortSignal.timeout(1000));
    await assert.rejects(
      connection.connect({
        bearer: 'fixture-token',
        fetch: async () => {
          calls++;
          if (kind === 'network') throw new Error('network error containing a secret');
          return new Response('remote secret must not escape', {
            status: 401,
            headers: { 'www-authenticate': 'Bearer' },
          });
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, /secret|fixture-token/);
        return true;
      },
    );
    assert.equal(calls, 1);
    await connection.close();
  }
});

function fakeNetwork(
  body: string | Buffer,
  status = 200,
  responseHeaders: Record<string, string> = {},
) {
  const calls: Array<{ url: URL; options: RequestOptions; body?: unknown }> = [];
  const request = (
    url: URL,
    options: RequestOptions,
    receive: (response: IncomingMessage) => void,
  ): ClientRequest => {
    const entry: { url: URL; options: RequestOptions; body?: unknown } = { url, options };
    calls.push(entry);
    const req = new EventEmitter() as ClientRequest;
    req.setTimeout = () => req;
    req.destroy = () => req;
    req.end = ((input?: unknown) => {
      entry.body = input;
      queueMicrotask(() => {
        const response = new PassThrough() as unknown as IncomingMessage;
        response.statusCode = status;
        response.headers = { 'content-type': 'application/json', ...responseHeaders };
        receive(response);
        (response as unknown as PassThrough).end(body);
      });
      return req;
    }) as ClientRequest['end'];
    return req;
  };
  return { calls, request };
}
test('endpoint policy rejects private, mapped, multicast and reserved IPs, and fixes lookup to checked IP', async () => {
  for (const address of [
    '127.0.0.1',
    '10.1.2.3',
    '100.64.1.1',
    '169.254.169.254',
    '192.0.2.1',
    '224.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '2002:7f00:1::1',
  ])
    assert.equal(isPublicAddress(address), false, address);
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])
    assert.equal(isPublicAddress(address), true, address);
  const c = config(),
    network = fakeNetwork('{"ok":true}');
  let resolves = 0;
  const http = controlledHttp(c, AbortSignal.timeout(1000), {
    ...network,
    resolve: async () => {
      resolves++;
      return [{ address: '8.8.8.8', family: 4 }];
    },
  });
  try {
    await assert.rejects(http.fetch('https://mcp.example/another-path'), {
      code: 'MCP_ENDPOINT_CHANGED',
    });
    await assert.rejects(http.fetch('https://other.example/mcp'), { code: 'MCP_ENDPOINT_CHANGED' });
    const response = await http.fetch('https://mcp.example/mcp', {
      method: 'POST',
      body: '{}',
      headers: { Authorization: 'Bearer fixture' },
    });
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(resolves, 1);
    assert.equal(network.calls.length, 1);
    const opts = network.calls[0]!.options;
    assert.equal(opts.agent, false);
    assert.equal(network.calls[0]!.url.hostname, 'mcp.example');
    await new Promise<void>((resolve, reject) =>
      opts.lookup!('mcp.example', { family: 4, all: false }, (error, address, family) => {
        if (error) {
          reject(error);
          return;
        }
        assert.equal(address, '8.8.8.8');
        assert.equal(family, 4);
        resolve();
      }),
    );
  } finally {
    http.close();
  }
  const blocked = controlledHttp(c, AbortSignal.timeout(1000), {
    ...network,
    resolve: async () => [{ address: '127.0.0.1', family: 4 }],
  });
  await assert.rejects(blocked.fetch('https://mcp.example/mcp'), {
    code: 'MCP_PRIVATE_DESTINATION',
  });
  assert.equal(network.calls.length, 1);
  blocked.close();
});

test('controlled HTTP rejects redirects and oversized responses before SDK JSON parsing', async () => {
  for (const [body, status, headers, code] of [
    ['', 302, { location: 'https://other.example/' }, 'MCP_REDIRECT_DENIED'],
    ['', 200, { 'content-length': '999999999' }, 'MCP_FRAME_LIMIT'],
    [Buffer.alloc(8 * 1024 * 1024 + 1), 200, {}, 'MCP_FRAME_LIMIT'],
    ['', 200, { 'content-encoding': 'gzip' }, 'MCP_ENCODING_UNSUPPORTED'],
  ] as const) {
    const network = fakeNetwork(body, status, headers);
    const http = controlledHttp(config(), AbortSignal.timeout(1000), {
      ...network,
      resolve: async () => [{ address: '8.8.8.8', family: 4 }],
    });
    await assert.rejects(async () => (await http.fetch('https://mcp.example/mcp')).text(), {
      code,
    });
    assert.equal(network.calls.length, 1);
    http.close();
  }
});

test('cancelled DNS lookup cannot create a late network connection', async () => {
  const cancel = new AbortController(),
    network = fakeNetwork('{}');
  let finish: (value: Array<{ address: string; family: number }>) => void = () => {};
  const http = controlledHttp(config(), cancel.signal, {
    ...network,
    resolve: () =>
      new Promise((r) => {
        finish = r;
      }),
  });
  const pending = http.fetch('https://mcp.example/mcp');
  cancel.abort();
  await assert.rejects(pending, { code: 'MCP_CANCELLED' });
  finish([{ address: '8.8.8.8', family: 4 }]);
  await new Promise((r) => setImmediate(r));
  assert.equal(network.calls.length, 0);
  http.close();
});

test('auto mode permits one legacy fallback only after non-modern HTTP evidence', async () => {
  const c = config(),
    calls: string[] = [];
  const connection = new McpConnection(c, bind(c), AbortSignal.timeout(1500));
  try {
    await connection.connect({
      fetch: async (_url, init) => {
        if (init?.method === 'GET') return new Response(null, { status: 405 });
        const body = JSON.parse(String(init?.body));
        calls.push(body.method);
        if (body.method === 'server/discover')
          return new Response('Unknown request', { status: 400 });
        if (body.method === 'initialize')
          return reply(body.id, {
            protocolVersion: '2025-11-25',
            capabilities: {},
            serverInfo: { name: 'fixture', version: '1' },
          });
        if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
        throw new Error('unexpected request');
      },
    });
    assert.deepEqual(calls, ['server/discover', 'initialize', 'notifications/initialized']);
    assert.equal((await connection.catalog()).tools.length, 0);
  } finally {
    await connection.close();
  }
});

test('maintenance persists intent before network and reports actual capabilities without enabling config', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'praxis-mcp-maintenance-'));
  const store = new SessionStore(':memory:'),
    c = config();
  const configs = new McpConfigService(directory, () => {});
  await configs.upsert(c, 0, null);
  let calls = 0;
  const maintenance = new McpMaintenance(
    configs,
    store,
    'owner-a',
    'desktop',
    async (_url, init) => {
      calls++;
      const rows = store.db
        .prepare('SELECT owner,state,document FROM maintenance_operations')
        .all();
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.state, 'running');
      assert.equal(rows[0]?.owner, 'owner-a');
      assert.equal(JSON.parse(String(rows[0]?.document)).serverId, c.id);
      const body = JSON.parse(String(init?.body));
      if (body.method === 'server/discover')
        return reply(
          body.id,
          complete({
            supportedVersions: ['2026-07-28'],
            capabilities: { tools: {}, resources: {} },
          }),
        );
      assert.equal(body.method, 'tools/list');
      return reply(body.id, complete({ tools: [echo] }));
    },
  );
  try {
    await assert.rejects(maintenance.test(c.id, 2), { code: 'MCP_CONFIG_CHANGED' });
    assert.equal(calls, 0);
    const result = await maintenance.test(c.id, 1);
    assert.equal(result.protocol, '2026-07-28');
    assert.equal(result.toolCount, 1);
    assert.deepEqual(result.capabilities, { tools: true, resources: true, prompts: false });
    assert.equal((await configs.file.read()).value[0]?.enabled, false);
    assert.equal(
      store.db.prepare('SELECT state FROM maintenance_operations').get()?.state,
      'succeeded',
    );
    assert.equal(calls, 2);
  } finally {
    await maintenance.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  'configuration changes and Host shutdown abort maintenance; recovery never restarts an operation',
  { timeout: 2000 },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'praxis-mcp-cancel-'));
    const file = path.join(directory, 'sessions.sqlite'),
      c = config();
    let store = new SessionStore(file);
    let maintenance: McpMaintenance | undefined;
    const configs = new McpConfigService(directory, (id) => maintenance?.cancel(id));
    await configs.upsert(c, 0, null);
    let reached: () => void = () => {};
    let started = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let requests = 0;
    maintenance = new McpMaintenance(configs, store, 'owner-a', 'cli', async (_url, init) => {
      requests++;
      reached();
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    });
    try {
      const pending = maintenance.test(c.id, 1);
      const rejected = assert.rejects(pending);
      await started;
      await assert.rejects(
        Promise.resolve().then(() => maintenance!.test(c.id, 1)),
        { code: 'MCP_BUSY' },
      );
      await configs.disable(c.id, 1);
      await rejected;
      assert.equal(
        store.db.prepare('SELECT state FROM maintenance_operations').get()?.state,
        'cancelled',
      );
      started = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const next = maintenance.test(c.id, 2);
      const cancelled = assert.rejects(next);
      await started;
      await maintenance.close();
      await cancelled;
      assert.equal(requests, 2);
      store.startMaintenance(randomUUID(), 'owner-a', c.id, 2);
      store.close();
      store = new SessionStore(file);
      store.recover();
      assert.equal(
        store.db
          .prepare("SELECT count(*) AS count FROM maintenance_operations WHERE state='interrupted'")
          .get()?.count,
        1,
      );
      assert.equal(
        store.db
          .prepare("SELECT count(*) AS count FROM maintenance_operations WHERE state='running'")
          .get()?.count,
        0,
      );
      assert.equal(requests, 2);
    } finally {
      await maintenance.close();
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

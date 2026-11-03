import { McpCredentials, SecretStore, type SecretBackend } from '@praxis/mcp-client/credentials';
import { McpConfigService, type McpConfig } from '@praxis/mcp-core';
import { uuid } from '@praxis/storage-local';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('Bearer references bind profile and exact endpoint, rotate epoch, and keep configuration free of secrets', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-mcp-auth-'));
  const values = new Map<string, string>(),
    invalidated: string[] = [];
  const backend: SecretBackend = {
    set: async (k, v) => {
      values.set(k, v);
    },
    get: async (k) => values.get(k),
    delete: async (k) => {
      values.delete(k);
    },
  };
  const configs = new McpConfigService(root, (id) => invalidated.push(id));
  const secrets = new SecretStore(backend);
  const credentials = new McpCredentials(configs, secrets, 'alice', 'cli', ['praxis-fixture-key']);
  const config: McpConfig = {
    id: uuid(),
    namespace: 'docs',
    displayName: 'Docs',
    revision: 1,
    enabled: false,
    protocol: 'auto',
    transport: {
      type: 'streamable-http',
      endpoint: 'https://example.invalid/mcp',
      allowPrivateDestination: false,
      auth: { type: 'none' },
    },
    capabilities: { tools: true, resources: false, prompts: false },
  };
  try {
    await configs.upsert(config, 0, null);
    await assert.rejects(credentials.setBearer(config.id, 1, 1, 'praxis-fixture-key'), {
      code: 'MCP_SECRET_DENIED',
    });
    const saved = await credentials.setBearer(config.id, 1, 1, 'fake-bearer-one');
    const current = saved.value[0]!;
    assert.equal(current.enabled, false);
    const first = await credentials.resolve(current, AbortSignal.timeout(1000));
    assert.equal(first.bearer, 'fake-bearer-one');
    assert.ok(first.authEpoch > 0);
    assert.ok(!(await readFile(configs.file.file, 'utf8')).includes('fake-bearer'));
    const moved = {
      ...current,
      transport: {
        ...config.transport,
        endpoint: 'https://other.invalid/mcp',
        auth:
          current.transport.type === 'streamable-http'
            ? current.transport.auth
            : { type: 'none' as const },
      },
    };
    await assert.rejects(credentials.resolve(moved, AbortSignal.timeout(1000)), {
      code: 'MCP_AUTH_REQUIRED',
    });
    const another = new McpCredentials(configs, new SecretStore(backend), 'bob', 'cli');
    await assert.rejects(another.resolve(current, AbortSignal.timeout(1000)), {
      code: 'MCP_AUTH_REQUIRED',
    });
    await another.close();
    const rotated = await credentials.setBearer(
      config.id,
      saved.revision,
      current.revision,
      'fake-bearer-two',
    );
    assert.ok(
      (await credentials.resolve(rotated.value[0]!, AbortSignal.timeout(1000))).authEpoch >
        first.authEpoch,
    );
    await assert.rejects(credentials.resolve(current, AbortSignal.timeout(1000)), {
      code: 'MCP_AUTH_REQUIRED',
    });
    assert.equal(values.size, 1);
    const cleared = await credentials.clear(
      config.id,
      rotated.revision,
      rotated.value[0]!.revision,
    );
    assert.equal(
      cleared.value[0]!.transport.type === 'streamable-http' &&
        cleared.value[0]!.transport.auth.type,
      'none',
    );
    assert.equal(values.size, 0);
    assert.equal(invalidated.length, 4);
  } finally {
    await credentials.close();
    await rm(root, { recursive: true, force: true });
  }
});

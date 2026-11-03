import { ConfigFile } from '@praxis/config';
import {
  McpCatalog,
  McpConfigService,
  ScopedReferences,
  ToolSelector,
  argumentHeaders,
  encodeHeader,
  modelToolName,
  normalizeResult,
  prepareSchema,
  validateConfig,
} from '@praxis/mcp-core';
import type { InstalledPlugin } from '@praxis/plugin-host';
import { PluginHost, PluginInstaller, inspectPackage } from '@praxis/plugin-host';
import { compileSchema } from '@praxis/schema';
import { SessionStore } from '@praxis/storage-local';
import { ToolExecutor } from '@praxis/tools';
import { WorkspaceFiles } from '@praxis/tools/files';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const manifest: InstalledPlugin['manifest'] = {
  id: 'example.fixture',
  version: '1.0.0',
  sdkVersion: '^1.0.0',
  entry: 'index.mjs',
  runtimes: ['local-host'],
  modes: ['agent'],
  capabilities: ['agent-tool'],
  platforms: ['darwin', 'linux', 'win32'],
};
const record: InstalledPlugin = { manifest, digest: 'a'.repeat(64), enabled: true };
const tool = {
  name: 'fixture_echo',
  description: 'Test',
  parameters: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
    additionalProperties: false,
  },
  async execute(input: unknown) {
    return input;
  },
};
const binding = {
  owner: 'alice',
  client: 'cli',
  serverId: randomUUID(),
  configRevision: 1,
  authEpoch: 1,
};
const signal = new AbortController().signal;
const rawTool = { name: 'echo', description: '回显', inputSchema: tool.parameters };

test('configuration revisions serialize concurrent edits and preserve the accepted content', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-config-'));
  try {
    const file = new ConfigFile(path.join(root, 'config.json'), (v) => v as string[], []);
    const result = await Promise.allSettled([
      file.update(0, () => ['one']),
      file.update(0, () => ['two']),
    ]);
    assert.equal(result.filter((r) => r.status === 'fulfilled').length, 1);
    assert.deepEqual(await file.read(), { revision: 1, value: ['one'] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('plugin installation binds reviewed bytes and activation verifies the immutable package', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-plugin-'));
  const source = path.join(root, 'source'),
    installer = new PluginInstaller(path.join(root, 'private'));
  const host = new PluginHost(new Set(), 'agent');
  try {
    await mkdir(source);
    await writeFile(path.join(source, 'praxis-plugin.json'), JSON.stringify(manifest));
    await writeFile(
      path.join(source, 'index.mjs'),
      'export default {activate(ctx){ctx.registerTool({name:"fixture_echo",description:"echo",parameters:{type:"object"},execute:async input=>input})}}',
    );
    const review = await installer.inspect(source);
    await assert.rejects(installer.install(source, 'b'.repeat(64), 0), /内容已变化/);
    await installer.install(source, review.digest, 0);
    assert.equal((await installer.records.read()).value[0]!.enabled, false);
    const enabled = (await installer.setEnabled(manifest.id, true, 1)).value[0]!;
    await host.load(installer, enabled);
    assert.equal(host.snapshot()[0]!.tools.size, 1);
    await writeFile(path.join(installer.path(enabled), 'index.mjs'), 'throw Error("tampered")');
    await assert.rejects(new PluginHost(new Set(), 'agent').load(installer, enabled), /完整性/);
    await symlink(path.join(source, 'index.mjs'), path.join(source, 'outside.mjs'));
    await assert.rejects(inspectPackage(source), /链接/);
  } finally {
    await host.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
test('failed activation leaves no partial registry, disposes resources, and forbids Chat tools', async () => {
  let cleaned = false;
  const host = new PluginHost(new Set(), 'agent');
  await assert.rejects(
    host.activate(record, {
      activate(ctx) {
        ctx.onDispose(() => {
          cleaned = true;
        });
        ctx.registerTool(tool);
        throw new Error('fixture failure');
      },
    }),
    /fixture failure/,
  );
  assert.equal(cleaned, true);
  assert.equal(host.snapshot().length, 0);
  await assert.rejects(
    new PluginHost(new Set(), 'chat').activate(
      { ...record, manifest: { ...record.manifest, modes: ['chat'] } },
      {
        activate(ctx) {
          ctx.registerTool(tool);
        },
      },
    ),
    /Chat 模式/,
  );
  const timed = new PluginHost(new Set(), 'agent', 5);
  await assert.rejects(
    timed.activate(record, { activate: () => new Promise(() => {}) }),
    /超过时间限制/,
  );
  assert.equal(timed.snapshot().length, 0);
});
test('trusted plugin delegates file changes through core permissions and records child effects', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-plugin-tools-'));
  const store = new SessionStore(':memory:');
  const host = new PluginHost(new Set(['fs_write']), 'agent');
  try {
    await host.activate(record, {
      activate(ctx) {
        ctx.registerTool({
          name: 'fixture_create',
          description: 'Create fixture',
          parameters: { type: 'object' },
          async execute(_input, services) {
            return services.invokeCore('fs_write', {
              path: 'index.html',
              mode: 'create',
              content: '<h1>Hello</h1>',
            });
          },
        });
      },
    });
    const session = store.create('alice', 'agent', root),
      files = await WorkspaceFiles.open(root, (kind, content) =>
        store.artifact(session.id, kind, content),
      );
    const executor = new ToolExecutor(
      session.id,
      store,
      files,
      async () => null,
      undefined,
      host.snapshot(),
    );
    const result = await executor.execute(
      { id: 'provider-id', name: 'fixture_create', arguments: '{}' },
      randomUUID(),
      signal,
    );
    assert.equal(result.status, 'succeeded');
    assert.equal(await readFile(path.join(root, 'index.html'), 'utf8'), '<h1>Hello</h1>');
    assert.ok(store.events(session.id).some((e) => e.type === 'plugin/tool-result'));
  } finally {
    await host.dispose();
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
test('schema validation rejects unsupported constraints instead of weakening input contracts', () => {
  assert.throws(() => compileSchema({ type: 'string', pattern: '(a+)+' }), /不支持的约束/);
  assert.throws(() => compileSchema({ $ref: 'https://example.invalid/schema' }), /不支持的约束/);
  const schema = compileSchema(tool.parameters);
  schema.validate({ text: 'hello' });
  assert.throws(() => schema.validate({ text: 1 }));
  assert.throws(() => schema.validate({ text: 'ok', permission: 'approved' }));
});
test('MCP paginated catalog publishes atomically and marks previous snapshot stale on failure', async () => {
  const catalog = new McpCatalog();
  const first = await catalog.refresh(
    binding,
    'demo',
    '2026-07-28',
    '',
    async () => ({ tools: [rawTool] }),
    signal,
  );
  let calls = 0;
  await assert.rejects(
    catalog.refresh(
      binding,
      'demo',
      '2026-07-28',
      '',
      async () => {
        calls++;
        return { tools: calls === 1 ? [rawTool] : [], nextCursor: 'loop' };
      },
      signal,
    ),
    /游标循环/,
  );
  assert.equal(catalog.snapshot()!.generation, first.generation);
  assert.equal(catalog.snapshot()!.stale, true);
  await assert.rejects(
    catalog.refresh(
      binding,
      'demo',
      '2026-07-28',
      '',
      async () => ({ tools: [rawTool, rawTool] }),
      signal,
    ),
    /重复工具/,
  );
});
test('MCP tool identity is stable, schema rejection is explicit, and selection waits for the next step', async () => {
  const catalog = await new McpCatalog().refresh(
    binding,
    'demo',
    '2026-07-28',
    '',
    async () => ({
      tools: [
        rawTool,
        {
          ...rawTool,
          name: 'unsafe',
          inputSchema: { type: 'object', $ref: 'https://example.invalid' },
        },
      ],
    }),
    signal,
  );
  assert.equal(catalog.tools.length, 1);
  assert.equal(catalog.rejected.length, 1);
  assert.notEqual(modelToolName('one', 'same', '工具'), modelToolName('two', 'same', '工具'));
  assert.ok(modelToolName('one', 'long'.repeat(100), 'long'.repeat(100)).length <= 64);
  const selector = new ToolSelector(4000),
    name = catalog.tools[0]!.modelName;
  selector.discover(catalog);
  assert.throws(() => selector.resolve(name), /尚未出现/);
  selector.boundary();
  assert.equal(selector.resolve(name).rawName, 'echo');
  assert.throws(() => selector.discover({ ...catalog, generation: 'changed' }), /固定目录已变化/);
  const constrained = new ToolSelector(1);
  constrained.discover(catalog);
  assert.equal(constrained.boundary().excluded.length, 1);
});
test('modern MCP mirror headers preserve Unicode and reject ambiguous or misplaced annotations', async () => {
  const schema = {
    type: 'object',
    properties: { greeting: { type: 'string', 'x-mcp-header': 'Greeting' } },
    required: ['greeting'],
  };
  const catalog = await new McpCatalog().refresh(
    binding,
    'demo',
    '2026-07-28',
    '',
    async () => ({ tools: [{ ...rawTool, inputSchema: schema }] }),
    signal,
  );
  assert.deepEqual(argumentHeaders(catalog.tools[0]!, { greeting: '你好\r\n' }), {
    'Mcp-Param-Greeting': `=?base64?${Buffer.from('你好\r\n').toString('base64')}?=`,
  });
  assert.notEqual(encodeHeader('=?base64?literal?='), '=?base64?literal?=');
  assert.throws(
    () =>
      prepareSchema({
        type: 'object',
        properties: {
          x: { type: 'string', 'x-mcp-header': 'x' },
          y: { type: 'boolean', 'x-mcp-header': 'X' },
        },
      }),
    /Header 注解无效/,
  );
  assert.throws(
    () =>
      prepareSchema({
        type: 'object',
        properties: { a: { type: 'array', items: { type: 'string', 'x-mcp-header': 'x' } } },
      }),
    /Header 注解无效/,
  );
});
test('MCP config remains disabled after edits and private references cannot cross owners or epochs', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-mcp-'));
  const invalidated: string[] = [];
  const raw = {
    id: binding.serverId,
    namespace: 'demo',
    displayName: 'Example',
    revision: 1,
    enabled: true,
    protocol: 'auto',
    transport: {
      type: 'streamable-http',
      endpoint: 'https://example.invalid/mcp',
      auth: { type: 'none' },
    },
    capabilities: { tools: true, resources: true, prompts: true },
  };
  try {
    const service = new McpConfigService(root, (id) => invalidated.push(id));
    const saved = await service.upsert(raw, 0, null);
    assert.equal(saved.value[0]!.enabled, false);
    assert.deepEqual(invalidated, [binding.serverId]);
    assert.throws(() =>
      validateConfig({ ...raw, transport: { ...raw.transport, endpoint: 'http://127.0.0.1/mcp' } }),
    );
    assert.throws(() =>
      validateConfig({
        ...raw,
        transport: { ...raw.transport, endpoint: 'https://example.invalid/mcp?token=fixture' },
      }),
    );
    const refs = new ScopedReferences<{ uri: string }>(),
      scope = { ...binding, generation: 'one' },
      id = refs.issue(scope, { uri: 'file:///resource-on-server' });
    assert.equal(refs.read(scope, id).uri, 'file:///resource-on-server');
    assert.throws(() => refs.read({ ...scope, owner: 'bob' }, id));
    assert.throws(() => refs.read({ ...scope, authEpoch: 2 }, id));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('MCP results separate remote failure, unknown effects and unsupported binary content', () => {
  const result = normalizeResult({
    isError: true,
    content: [
      { type: 'text', text: 'partial effect' },
      { type: 'image', data: 'not forwarded' },
      { type: 'resource_link', uri: 'https://example.invalid/private', name: 'Resource' },
    ],
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.effectState, 'unknown');
  assert.deepEqual(result.unsupportedContent, ['image']);
  assert.ok(!JSON.stringify(result).includes('not forwarded'));
  assert.throws(() =>
    normalizeResult(
      { content: [], structuredContent: { result: 1 } },
      { type: 'object', properties: { result: { type: 'string' } } },
    ),
  );
});

import { fingerprint } from '@praxis/config';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { mcpExecutor } from './fixtures/mcp-executor.ts';

interface Page {
  entries: Array<{ resourceRef: string; uri: string; templateRef: string }>;
  nextCursor?: string;
}

test('resource URI stays remote; text snapshots and hashes survive pagination and later changes', async () => {
  const env = await mcpExecutor(false, true);
  try {
    const canary = path.join(env.root, 'private.txt');
    await writeFile(canary, 'private fixture content must not be read');
    env.remote.resources!.uri = pathToFileURL(canary).href;
    env.remote.resources!.paging = true;
    const listed = await env.execute('mcp_list_resources', { serverId: env.config.id, limit: 1 });
    assert.equal(listed.status, 'succeeded');
    const page = listed.data as Page;
    assert.ok(!JSON.stringify(page).includes('private-server-resource-cursor'));
    const read = await env.execute('mcp_read_resource', {
      resourceRef: page.entries[0]!.resourceRef,
    });
    assert.equal(read.status, 'succeeded');
    const artifact = env.store.readArtifact(env.session.id, read.artifactIds[0]!);
    assert.equal(artifact.kind, 'mcp-resource');
    const content = JSON.parse(artifact.content) as {
      contents: unknown;
      unsupportedContent: unknown;
      contentHash: string;
    };
    assert.equal(
      content.contentHash,
      fingerprint({ contents: content.contents, unsupportedContent: content.unsupportedContent }),
    );
    assert.ok(artifact.content.includes('Remote resource text'));
    assert.ok(!artifact.content.includes('private fixture content'));
    env.remote.resources!.text = 'Changed after snapshot';
    assert.equal(
      env.store.readArtifact(env.session.id, read.artifactIds[0]!).content,
      artifact.content,
    );
    const second = await env.execute('mcp_list_resources', {
      serverId: env.config.id,
      limit: 1,
      cursor: page.nextCursor,
    });
    const linked = (second.data as Page).entries[0]!;
    const external = await env.execute('mcp_read_resource', { resourceRef: linked.resourceRef });
    assert.equal(external.status, 'succeeded');
    assert.equal(
      env.requests.filter((r) => r.method === 'resources/read').at(-1)?.params.uri,
      'https://never-fetch.invalid/other.txt',
    );
    assert.equal(
      env.store.events(env.session.id).filter((e) => e.type === 'approval/consumed').length,
      2,
    );
  } finally {
    await env.close();
  }
});

test('template expansion accepts only discovered variables and approval displays exact URI', async () => {
  for (const legacy of [false, true]) {
    const env = await mcpExecutor(legacy, true);
    try {
      const listed = await env.execute('mcp_list_resources', {
        serverId: env.config.id,
        kind: 'templates',
      });
      const ref = (listed.data as Page).entries[0]!.templateRef;
      const invalid = await env.execute('mcp_read_resource', {
        templateRef: ref,
        arguments: { wrong: 'value' },
      });
      assert.equal(invalid.error?.code, 'INVALID_ARGUMENT');
      const read = await env.execute('mcp_read_resource', {
        templateRef: ref,
        arguments: { name: 'hello world' },
      });
      assert.equal(read.status, 'succeeded');
      assert.equal(
        env.requests.filter((r) => r.method === 'resources/read')[0]?.params.uri,
        'doc://reference/hello%20world',
      );
      const approval = env.store
        .events(env.session.id)
        .find((e) => e.type === 'approval/requested');
      assert.equal(
        (approval?.payload.parameters as { uri: string }).uri,
        'doc://reference/hello%20world',
      );
    } finally {
      await env.close();
    }
  }
});

test('resource references reject cross-session reuse, changed queries, and changed catalogs', async () => {
  const env = await mcpExecutor(false, true),
    other = await mcpExecutor(false, true);
  try {
    const args = { serverId: env.config.id, limit: 1 };
    const listed = await env.execute('mcp_list_resources', args);
    const page = listed.data as Page,
      ref = page.entries[0]!.resourceRef;
    const crossed = await other.execute('mcp_read_resource', { resourceRef: ref });
    assert.equal(crossed.error?.code, 'MCP_REFERENCE_EXPIRED');
    const cursor = await env.execute('mcp_list_resources', {
      ...args,
      limit: 2,
      cursor: page.nextCursor,
    });
    assert.equal(cursor.error?.code, 'MCP_REFERENCE_EXPIRED');
    env.remote.resources!.title = 'New catalog title';
    const changed = await env.execute('mcp_read_resource', { resourceRef: ref });
    assert.equal(changed.error?.code, 'MCP_CATALOG_CHANGED');
    await env.execute('mcp_list_resources', args);
    const expired = await env.execute('mcp_read_resource', { resourceRef: ref });
    assert.equal(expired.error?.code, 'MCP_REFERENCE_EXPIRED');
    assert.equal(env.requests.filter((r) => r.method === 'resources/read').length, 0);
    assert.equal(other.requests.filter((r) => r.method === 'resources/read').length, 0);
  } finally {
    await env.close();
    await other.close();
  }
});

test('denied reads never dispatch; binary and oversized resource results are explicit failures', async () => {
  for (const scenario of ['deny', 'binary', 'oversize']) {
    const env = await mcpExecutor(false, true);
    try {
      const listed = await env.execute('mcp_list_resources', { serverId: env.config.id });
      env.decisions.deny = scenario === 'deny';
      env.remote.resources!.binary = scenario === 'binary';
      if (scenario === 'oversize') env.remote.resources!.text = 'x'.repeat(2 * 1024 * 1024);
      const result = await env.execute('mcp_read_resource', {
        resourceRef: (listed.data as Page).entries[0]!.resourceRef,
      });
      assert.equal(
        result.error?.code,
        scenario === 'deny'
          ? 'APPROVAL_REJECTED'
          : scenario === 'binary'
            ? 'MCP_CONTENT_UNSUPPORTED'
            : 'MCP_RESULT_LIMIT',
      );
      assert.equal(result.effectState, scenario === 'deny' ? 'none' : 'unknown');
      assert.equal(
        env.requests.filter((r) => r.method === 'resources/read').length,
        scenario === 'deny' ? 0 : 1,
      );
      if (scenario === 'binary') {
        const saved = env.store.readArtifact(env.session.id, result.artifactIds[0]!);
        assert.ok(!saved.content.includes('YmluYXJ5LW11c3Qtbm90LWJlLXByb2plY3RlZA=='));
        assert.ok(saved.content.includes('unsupportedContent'));
      }
    } finally {
      await env.close();
    }
  }
});

test('invalid resource pagination and disabled capabilities cannot expose readable references', async () => {
  const env = await mcpExecutor(false, true),
    disabled = await mcpExecutor();
  try {
    env.remote.resources!.loop = true;
    const result = await env.execute('mcp_list_resources', { serverId: env.config.id });
    assert.equal(result.error?.code, 'MCP_CATALOG_INVALID');
    const unavailable = await disabled.execute('mcp_list_resources', {
      serverId: disabled.config.id,
    });
    assert.equal(unavailable.error?.code, 'TOOL_NOT_AVAILABLE');
    assert.equal(disabled.requests.filter((r) => r.method.startsWith('resources/')).length, 0);
  } finally {
    await env.close();
    await disabled.close();
  }
});

test('cancellation after resource dispatch closes the request without replay', async () => {
  const env = await mcpExecutor(false, true);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const listed = await env.execute('mcp_list_resources', { serverId: env.config.id });
    env.remote.resources!.beforeRead = async () => {
      env.cancel.abort();
      await held;
    };
    const read = await env.execute('mcp_read_resource', {
      resourceRef: (listed.data as Page).entries[0]!.resourceRef,
    });
    assert.equal(read.status, 'cancelled');
    assert.equal(read.effectState, 'unknown');
    assert.equal(env.requests.filter((r) => r.method === 'resources/read').length, 1);
  } finally {
    release();
    await env.close();
  }
});

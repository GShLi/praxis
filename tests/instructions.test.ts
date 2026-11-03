import { AgentRuntime } from '@praxis/agent-runtime';
import type { ModelConfig } from '@praxis/contracts';
import type { ModelRequest } from '@praxis/model-core';
import { SessionStore, uuid } from '@praxis/storage-local';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const config: ModelConfig = {
  id: 'fixture',
  revision: 1,
  baseUrl: 'https://example.invalid',
  apiKey: 'fixture',
  model: 'fixture',
  contextWindow: 128000,
  maxOutputTokens: 4096,
};
function completion(name?: string, args?: unknown) {
  return {
    message: {
      id: uuid(),
      role: 'assistant' as const,
      content: name ? '' : 'done',
      ...(name ? { toolCalls: [{ id: uuid(), name, arguments: JSON.stringify(args) }] } : {}),
    },
    usage: { input: 0, output: 0 },
    finishReason: name ? 'tool_calls' : 'stop',
  };
}
async function fixture(
  complete: (request: ModelRequest) => Promise<ReturnType<typeof completion>>,
) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'praxis-instructions-'));
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'AGENTS.md'), 'ROOT RULE');
  await writeFile(path.join(root, 'src', 'AGENTS.md'), 'CHILD RULE');
  const store = new SessionStore(':memory:');
  const session = store.create('u', 'agent', root);
  const runtime = new AgentRuntime(store, { model: { complete }, beginUse: async () => config });
  return {
    root,
    store,
    session,
    runtime,
    async close() {
      await runtime.close();
      store.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test('new directory instructions block a stale write and become replayable before the next decision', async () => {
  let calls = 0;
  const f = await fixture(async (request) => {
    calls++;
    if (calls === 1)
      return completion('fs_write', { path: 'src/index.html', mode: 'create', content: 'hello' });
    if (calls === 2) {
      const result = JSON.parse(request.messages.at(-1)!.content);
      assert.equal(result.error.code, 'INSTRUCTIONS_CHANGED');
      assert.equal(result.effectState, 'none');
      await assert.rejects(readFile(path.join(f.root, 'src', 'index.html')), { code: 'ENOENT' });
      assert.ok(request.messages.some((m) => m.content.includes('CHILD RULE')));
      return completion('fs_write', { path: 'src/index.html', mode: 'create', content: 'hello' });
    }
    return completion();
  });
  try {
    f.runtime.prompt('u', {
      sessionId: f.session.id,
      requestId: uuid(),
      text: 'write',
      mode: 'queue',
    });
    await f.runtime.wait(f.session.id);
    assert.equal(f.store.get(f.session.id).status, 'completed');
    assert.equal(await readFile(path.join(f.root, 'src', 'index.html'), 'utf8'), 'hello');
    const snapshots = f.store
      .events(f.session.id)
      .filter((e) => e.type === 'instructions/snapshot');
    assert.equal(snapshots.length, 2);
    assert.equal(snapshots[1]?.payload.instructionRevision, 2);
    assert.match(JSON.stringify(snapshots[1]), /contentObjectId/);
  } finally {
    await f.close();
  }
});

test('instruction changes during a model request stop its write and deleted rules leave history', async () => {
  let calls = 0;
  const f = await fixture(async (request) => {
    calls++;
    if (calls === 1) {
      await writeFile(path.join(f.root, 'AGENTS.md'), 'UPDATED RULE');
      return completion('fs_write', { path: 'index.html', mode: 'create', content: 'hello' });
    }
    if (calls === 2) {
      assert.ok(request.messages.some((m) => m.content.includes('UPDATED RULE')));
      assert.equal(JSON.parse(request.messages.at(-1)!.content).error.code, 'INSTRUCTIONS_CHANGED');
      await rm(path.join(f.root, 'AGENTS.md'));
      return completion('fs_read', { path: 'src/AGENTS.md' });
    }
    assert.ok(
      !request.messages
        .filter((m) => m.id.startsWith('instructions:'))
        .some((m) => m.content.includes('UPDATED RULE')),
    );
    return completion();
  });
  try {
    f.runtime.prompt('u', {
      sessionId: f.session.id,
      requestId: uuid(),
      text: 'write',
      mode: 'queue',
    });
    await f.runtime.wait(f.session.id);
    assert.equal(f.store.get(f.session.id).status, 'completed');
    await assert.rejects(readFile(path.join(f.root, 'index.html')), { code: 'ENOENT' });
    assert.ok(
      f.store.events(f.session.id).filter((e) => e.type === 'instructions/snapshot').length >= 3,
    );
  } finally {
    await f.close();
  }
});

test('search discovers child rules and later turns refresh the persisted instruction scopes', async () => {
  let calls = 0;
  const f = await fixture(async (request) => {
    calls++;
    if (calls === 1) return completion('fs_find', { pattern: '**/*.md' });
    assert.ok(
      request.messages.some(
        (m) =>
          m.id.startsWith('instructions:') &&
          m.content.includes(calls === 2 ? 'CHILD RULE' : 'CHILD UPDATED'),
      ),
    );
    return completion();
  });
  try {
    f.runtime.prompt('u', {
      sessionId: f.session.id,
      requestId: uuid(),
      text: 'find',
      mode: 'queue',
    });
    await f.runtime.wait(f.session.id);
    assert.equal(f.store.get(f.session.id).status, 'completed');
    await writeFile(path.join(f.root, 'src', 'AGENTS.md'), 'CHILD UPDATED');
    f.runtime.prompt('u', {
      sessionId: f.session.id,
      requestId: uuid(),
      text: 'continue',
      mode: 'queue',
    });
    await f.runtime.wait(f.session.id);
    assert.equal(f.store.get(f.session.id).status, 'completed');
    assert.equal(calls, 3);
    assert.equal(
      f.store.latestEvent(f.session.id, 'instructions/snapshot')?.payload.instructionRevision,
      3,
    );
  } finally {
    await f.close();
  }
});

test('oversized project instructions fail before the model and retain the previous snapshot', async () => {
  let calls = 0;
  const f = await fixture(async () => {
    calls++;
    return completion();
  });
  try {
    await writeFile(path.join(f.root, 'AGENTS.md'), 'x'.repeat(64 * 1024 + 1));
    f.runtime.prompt('u', {
      sessionId: f.session.id,
      requestId: uuid(),
      text: 'test',
      mode: 'queue',
    });
    await f.runtime.wait(f.session.id);
    assert.equal(calls, 0);
    assert.equal(f.store.get(f.session.id).status, 'failed');
    assert.equal(
      f.store.latestEvent(f.session.id, 'turn/error')?.payload.code,
      'INSTRUCTIONS_LIMIT',
    );
    assert.equal(f.store.latestEvent(f.session.id, 'instructions/snapshot'), undefined);
  } finally {
    await f.close();
  }
});

test('session creation snapshots root instructions and rejects invalid rules without an orphan session', async () => {
  const f = await fixture(async () => completion());
  try {
    const created = await f.runtime.create('u', 'agent', f.root);
    assert.equal(
      f.store.latestEvent(created.id, 'instructions/snapshot')?.payload.instructionRevision,
      1,
    );
    const count = f.store.list('u').length;
    await writeFile(path.join(f.root, 'AGENTS.md'), 'x'.repeat(65537));
    await assert.rejects(f.runtime.create('u', 'agent', f.root), { code: 'INSTRUCTIONS_LIMIT' });
    assert.equal(f.store.list('u').length, count);
    // Even an explicitly passed local path does not give Chat file capabilities.
    const chat = await f.runtime.create('u', 'chat', f.root);
    assert.equal(f.store.latestEvent(chat.id, 'instructions/snapshot'), undefined);
  } finally {
    await f.close();
  }
});

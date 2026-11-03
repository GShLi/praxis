import { AgentRuntime } from '@praxis/agent-runtime';
import { SessionStore, uuid } from '@praxis/storage-local';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('SQLite capacity failure before tool dispatch stops the turn and recovery never runs the pending write', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-runtime-capacity-'));
  const workspace = path.join(root, 'workspace');
  await mkdir(workspace);
  const filename = path.join(root, 'sessions.sqlite');
  let store = new SessionStore(filename);
  const fixture = capacityRuntime(store);
  const { runtime } = fixture;
  const fatal: unknown[] = [];
  runtime.on('fatal', (error) => fatal.push(error));
  try {
    const session = await runtime.create('capacity-fixture', 'agent', workspace);
    runtime.prompt('capacity-fixture', {
      sessionId: session.id,
      requestId: uuid(),
      text: 'create a page',
    });
    const waited = await Promise.allSettled([runtime.wait(session.id)]);
    assert.equal(
      fixture.calls(),
      1,
      'Storage failure must never retry the model or dispatch the tool.',
    );
    assert.equal(runtime.busy, false);
    assert.equal(Boolean(store.latestEvent(session.id, 'tool/intent')), false);
    assert.notEqual(store.get(session.id).status, 'completed');
    if (waited[0]?.status === 'rejected') assert.equal(fatal.length, 1);
    else assert.equal(store.get(session.id).status, 'failed');
    await assert.rejects(readFile(path.join(workspace, 'must-not-exist.html')), { code: 'ENOENT' });
    await runtime.close();
    store.close();
    store = new SessionStore(filename);
    store.db.exec('PRAGMA max_page_count=4096');
    store.recover();
    assert.equal(store.messages(session.id).filter((message) => message.role === 'user').length, 1);
    assert.equal(store.inputs(session.id, 'pending').length, 0);
    assert(['failed', 'interrupted'].includes(store.get(session.id).status));
    await assert.rejects(readFile(path.join(workspace, 'must-not-exist.html')), { code: 'ENOENT' });
    assert.equal(store.db.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
  } finally {
    await runtime.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

function capacityRuntime(store: SessionStore) {
  let calls = 0;
  const runtime = new AgentRuntime(store, {
    beginUse: async () => ({
      id: 'capacity-fixture',
      revision: 1,
      model: 'fixture',
      apiKey: 'fixture',
      baseUrl: 'https://example.invalid',
      contextWindow: 128000,
      maxOutputTokens: 4096,
    }),
    model: {
      async complete() {
        calls++;
        const pages = Number(store.db.prepare('PRAGMA page_count').get()?.page_count);
        store.db.exec(`PRAGMA max_page_count=${pages}`);
        return {
          message: {
            id: uuid(),
            role: 'assistant' as const,
            content: 'x'.repeat(128 * 1024),
            toolCalls: [
              {
                id: uuid(),
                name: 'fs_write',
                arguments: JSON.stringify({
                  path: 'must-not-exist.html',
                  mode: 'create',
                  content: 'unexpected',
                }),
              },
            ],
          },
          usage: { input: 0, output: 0 },
          finishReason: 'tool_calls' as const,
        };
      },
    },
  });
  return { runtime, calls: () => calls };
}

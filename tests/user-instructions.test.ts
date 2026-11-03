import { AgentRuntime } from '@praxis/agent-runtime';
import type { ModelConfig } from '@praxis/contracts';
import { SessionStore, uuid } from '@praxis/storage-local';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const config: ModelConfig = {
  id: 'fixture',
  revision: 1,
  baseUrl: 'https://provider.invalid',
  apiKey: 'fixture-private-key',
  model: 'fixture',
  contextWindow: 16000,
  maxOutputTokens: 1000,
};

test('user instructions are pinned for a turn, change next turn, and remain replayable after disabling', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-user-instructions-'));
  await writeFile(path.join(root, 'note.txt'), 'file data');
  const store = new SessionStore(':memory:'),
    session = store.create('owner', 'agent', root);
  let settings = { revision: 1, value: { enabled: true, text: 'FIRST PERSONAL RULE' } },
    calls = 0;
  const runtime = new AgentRuntime(store, {
    beginUse: async () => config,
    userInstructions: async () => settings,
    model: {
      async complete(request) {
        calls++;
        const personal = request.messages.filter((m) => m.id.startsWith('user-instructions:'));
        if (calls <= 2) assert.match(personal[0]?.content ?? '', /FIRST PERSONAL RULE/);
        else if (calls === 3) assert.match(personal[0]?.content ?? '', /SECOND PERSONAL RULE/);
        else assert.equal(personal.length, 0);
        settings = { revision: 2, value: { enabled: true, text: 'SECOND PERSONAL RULE' } };
        return {
          message: {
            id: uuid(),
            role: 'assistant',
            content: calls === 1 ? '' : 'done',
            ...(calls === 1
              ? {
                  toolCalls: [
                    {
                      id: uuid(),
                      name: 'fs_read',
                      arguments: JSON.stringify({ path: 'note.txt' }),
                    },
                  ],
                }
              : {}),
          },
          usage: { input: 10, output: 10 },
          finishReason: calls === 1 ? 'tool_calls' : 'stop',
        };
      },
    },
  });
  try {
    for (let turn = 0; turn < 3; turn++) {
      if (turn === 2)
        settings = { revision: 3, value: { enabled: false, text: 'SECOND PERSONAL RULE' } };
      runtime.prompt('owner', {
        sessionId: session.id,
        requestId: uuid(),
        text: 'continue',
        mode: 'queue',
      });
      await runtime.wait(session.id);
      assert.equal(store.get(session.id).status, 'completed');
    }
    const events = store.events(session.id).filter((e) => e.type === 'user-instructions/snapshot');
    assert.deepEqual(
      events.map((event) => event.payload.revision),
      [1, 2, 3],
    );
    const first = events[0]?.payload.contentObjectId;
    assert.equal(typeof first, 'string');
    assert.match(store.readArtifact(session.id, String(first)).content, /FIRST PERSONAL RULE/);
    assert.equal(events[2]?.payload.contentObjectId, null);
    assert.equal(calls, 4);
  } finally {
    await runtime.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

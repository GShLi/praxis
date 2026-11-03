import { AgentRuntime } from '@praxis/agent-runtime';
import type { Completion } from '@praxis/model-core';
import { SessionStore, uuid } from '@praxis/storage-local';
import { ManagedProcesses } from '@praxis/tools/processes';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { commandBackend } from './fixtures/command-backend.ts';

function completion(command: boolean): Completion {
  return {
    message: {
      id: uuid(),
      role: 'assistant',
      content: command ? '' : 'done',
      ...(command
        ? {
            toolCalls: [
              {
                id: uuid(),
                name: 'process_exec',
                arguments: JSON.stringify({
                  kind: 'exec',
                  executable: 'fixture',
                  args: [],
                  description: 'fixture',
                  yieldMs: 0,
                }),
              },
            ],
          }
        : {}),
    },
    usage: { input: 0, output: 0 },
    finishReason: command ? 'tool_calls' : 'stop',
  };
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-process-'));
  const store = new SessionStore(':memory:'),
    backend = commandBackend(true);
  let requests = 0;
  const runtime = new AgentRuntime(store, {
    interactive: true,
    model: {
      complete: async (request) => {
        if (requests++ === 0) return completion(true);
        const tool = JSON.parse(request.messages.filter((m) => m.role === 'tool').at(-1)!.content);
        assert.equal(tool.status, 'running');
        assert.equal(tool.data.processState, 'running');
        const facts = JSON.parse(request.messages.find((m) => m.id === 'runtime-facts')!.content);
        assert.equal(facts.executions.length, 1);
        return completion(false);
      },
    },
    beginUse: async () => ({
      id: 'fixture',
      revision: 1,
      baseUrl: 'https://example.invalid',
      apiKey: 'fixture',
      model: 'fixture',
      contextWindow: 32000,
      maxOutputTokens: 1000,
    }),
    processes: (session, db, turn) =>
      new ManagedProcesses({ store: db, sessionId: session.id, ...turn, backend: backend.backend }),
  });
  const session = await runtime.create('alice', 'agent', root);
  store.update(session.id, { permission: { mode: 'read-only', revision: 1, approval: 'ask' } });
  return {
    store,
    backend,
    runtime,
    session,
    requests: () => requests,
    close: async () => {
      backend.finish();
      await runtime.close();
      store.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test('runtime carries real call authorization, read-only command policy and final-answer cleanup through tool dispatch', async () => {
  const f = await fixture();
  let approvalCount = 0;
  f.store.on('event', (event) => {
    if (event.type !== 'approval/requested') return;
    const request = event.payload;
    approvalCount++;
    queueMicrotask(() =>
      f.runtime.approvals.respond('alice', {
        sessionId: request.sessionId,
        turnId: request.turnId,
        approvalId: request.approvalId,
        requestHash: request.requestHash,
        decision: 'approve-once',
      }),
    );
  });
  try {
    f.runtime.prompt('alice', {
      sessionId: f.session.id,
      requestId: uuid(),
      text: 'run fixture',
      mode: 'queue',
    });
    await f.runtime.wait(f.session.id);
    assert.equal(f.store.get(f.session.id).status, 'completed');
    assert.equal(f.requests(), 2);
    assert.equal(approvalCount, 1);
    assert.equal(f.backend.calls.started, 1);
    assert.equal(f.backend.calls.stopped, 1);
    assert.equal(f.backend.calls.closed, 1);
    const intent = f.store.latestEvent(f.session.id, 'execution/intent')!;
    const approval = f.store.latestEvent(f.session.id, 'approval/requested')!;
    assert.equal(intent.payload.callId, approval.payload.callId);
    const plan = intent.payload.plan as { sandbox: { fileMode: string } };
    assert.equal(plan.sandbox.fileMode, 'read-only');
    const finished = f.store.latestEvent(f.session.id, 'execution/finished')!;
    assert.equal((finished.payload.record as { processState: string }).processState, 'cancelled');
    assert.equal(f.store.matchingEvents(f.session.id, 'approval/consumed', 10).length, 1);
  } finally {
    await f.close();
  }
});

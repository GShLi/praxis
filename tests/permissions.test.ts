import { AgentRuntime } from '@praxis/agent-runtime';
import type { ModelConfig } from '@praxis/contracts';
import { ApprovalGate } from '@praxis/permissions';
import type { ActivePlugin } from '@praxis/plugin-host';
import { SessionStore, uuid } from '@praxis/storage-local';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const details = {
  callId: 'call-1',
  toolId: 'fs.write',
  parameters: { path: 'index.html', content: '<h1>Hello</h1>' },
  reason: 'Fixture policy',
};
function setup(interactive = true) {
  const store = new SessionStore(':memory:'),
    session = store.create('alice', 'agent', '/fixture');
  let turn: string | undefined = 'turn-1';
  const gate = new ApprovalGate(store, interactive, () => turn);
  const cancel = new AbortController();
  const respond = (decision: 'approve-once' | 'deny' = 'approve-once') => {
    const pending = gate.snapshot(session.id)!;
    return {
      sessionId: session.id,
      turnId: pending.turnId,
      approvalId: pending.approvalId,
      requestHash: pending.requestHash,
      decision,
    };
  };
  return {
    store,
    session,
    gate,
    cancel,
    respond,
    end: () => {
      turn = undefined;
    },
    close: () => {
      cancel.abort();
      store.close();
    },
  };
}
test('approvals bind identity, exact displayed content and turn, and can be consumed only once', async () => {
  const env = setup();
  try {
    const mutable = structuredClone(details);
    const pending = env.gate.forTurn(env.session.id, 'turn-1')(mutable, env.cancel.signal);
    mutable.parameters.content = 'changed';
    assert.equal(env.store.get(env.session.id).status, 'waiting_approval');
    assert.deepEqual(env.gate.snapshot(env.session.id)?.parameters, details.parameters);
    assert.throws(() => env.gate.respond('mallory', env.respond()), { code: 'SESSION_NOT_FOUND' });
    assert.throws(
      () => env.gate.respond('alice', { ...env.respond(), requestHash: 'f'.repeat(64) }),
      { code: 'APPROVAL_EXPIRED' },
    );
    assert.throws(() => env.gate.respond('alice', { ...env.respond(), turnId: 'another-turn' }), {
      code: 'APPROVAL_EXPIRED',
    });
    const response = env.respond();
    env.gate.respond('alice', response);
    const grant = await pending;
    assert.equal(env.gate.snapshot(env.session.id), null);
    assert.throws(() => env.gate.respond('alice', response), { code: 'APPROVAL_EXPIRED' });
    grant();
    assert.throws(grant, { code: 'APPROVAL_EXPIRED' });
    assert.equal(
      env.store.events(env.session.id).filter((e) => e.type === 'approval/consumed').length,
      1,
    );
  } finally {
    env.close();
  }
});
test('denial, cancellation and permission changes invalidate approval without yielding authority', async () => {
  for (const action of ['deny', 'cancel', 'permission']) {
    const env = setup();
    try {
      const pending = env.gate.forTurn(env.session.id, 'turn-1')(details, env.cancel.signal);
      const rejected = assert.rejects(pending);
      if (action === 'deny') env.gate.respond('alice', env.respond('deny'));
      else if (action === 'cancel') env.cancel.abort();
      else {
        env.store.update(env.session.id, {
          permission: { mode: 'read-only', approval: 'ask', revision: 1 },
        });
        env.gate.invalidate(env.session.id);
      }
      await rejected;
      assert.equal(env.gate.snapshot(env.session.id), null);
      assert.equal(
        env.store.events(env.session.id).filter((e) => e.type === 'approval/consumed').length,
        0,
      );
    } finally {
      env.close();
    }
  }
});
test('resolved tickets still recheck permission and turn immediately before dispatch', async () => {
  for (const action of ['permission', 'turn']) {
    const env = setup();
    try {
      const pending = env.gate.forTurn(env.session.id, 'turn-1')(details, env.cancel.signal);
      env.gate.respond('alice', env.respond());
      const grant = await pending;
      if (action === 'turn') env.end();
      else
        env.store.update(env.session.id, {
          permission: { mode: 'read-only', approval: 'ask', revision: 1 },
        });
      assert.throws(grant, { code: 'APPROVAL_EXPIRED' });
    } finally {
      env.close();
    }
  }
  const env = setup(false);
  try {
    await assert.rejects(env.gate.forTurn(env.session.id, 'turn-1')(details, env.cancel.signal), {
      code: 'APPROVAL_UNAVAILABLE',
    });
  } finally {
    env.close();
  }
});

const config: ModelConfig = {
  id: 'fixture',
  revision: 1,
  baseUrl: 'https://api.deepseek.com',
  model: 'fixture',
  apiKey: 'fixture',
  contextWindow: 32000,
  maxOutputTokens: 4096,
};
const plugin: ActivePlugin = {
  manifest: {
    id: 'test.policy',
    version: '1.0.0',
    sdkVersion: '^1.0.0',
    entry: 'index.mjs',
    runtimes: ['local-host'],
    modes: ['agent'],
    capabilities: ['policy-check'],
    platforms: ['darwin', 'linux', 'win32'],
  },
  digest: '0'.repeat(64),
  tools: new Map(),
  providers: new Map(),
  commands: new Map(),
  contributors: [],
  finished: [],
  checks: [async () => 'ask'],
};
test(
  'runtime waits for a real approval before writing and a hard-denied path never opens approval',
  { timeout: 3000 },
  async () => {
    for (const denied of [false, true]) {
      const root = await mkdtemp(path.join(tmpdir(), 'praxis-approval-'));
      const store = new SessionStore(':memory:'),
        session = store.create('alice', 'agent', root);
      let prompted: () => void = () => {};
      const asked = new Promise<void>((r) => {
        prompted = r;
      });
      let requests = 0;
      const runtime = new AgentRuntime(store, {
        interactive: true,
        beginUse: async () => config,
        plugins: () => [plugin],
        model: {
          async complete() {
            requests++;
            return {
              message: {
                id: uuid(),
                role: 'assistant',
                content: '',
                ...(requests === 1
                  ? {
                      toolCalls: [
                        {
                          id: uuid(),
                          name: 'fs_write',
                          arguments: JSON.stringify({
                            mode: 'create',
                            path: denied ? '.env' : 'index.html',
                            content: '<h1>Hello</h1>',
                          }),
                        },
                      ],
                    }
                  : {}),
              },
              usage: { input: 0, output: 0 },
              finishReason: requests === 1 ? 'tool_calls' : 'stop',
            };
          },
        },
      });
      store.on('event', (event) => {
        if (event.type === 'approval/requested') prompted();
      });
      try {
        runtime.prompt('alice', { sessionId: session.id, requestId: uuid(), text: 'create' });
        if (!denied) {
          await asked;
          await assert.rejects(readFile(path.join(root, 'index.html')), { code: 'ENOENT' });
          const approval = runtime.approvals.snapshot(session.id)!;
          runtime.approvals.respond('alice', {
            sessionId: session.id,
            turnId: approval.turnId,
            approvalId: approval.approvalId,
            requestHash: approval.requestHash,
            decision: 'approve-once',
          });
        }
        await runtime.wait(session.id);
        if (!denied)
          assert.equal(await readFile(path.join(root, 'index.html'), 'utf8'), '<h1>Hello</h1>');
        else {
          assert.equal(
            store.events(session.id).filter((e) => e.type === 'approval/requested').length,
            0,
          );
          await assert.rejects(readFile(path.join(root, '.env')), { code: 'ENOENT' });
        }
        const result = JSON.parse(
          store.messages(session.id).find((m) => m.role === 'tool')!.content,
        );
        assert.equal(result.status, denied ? 'denied' : 'succeeded');
      } finally {
        await runtime.close();
        store.close();
        await rm(root, { recursive: true, force: true });
      }
    }
  },
);

test(
  'final cleanup rejects a stale steer instead of silently carrying it into another turn',
  { timeout: 3000 },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'praxis-finish-'));
    const store = new SessionStore(':memory:'),
      session = store.create('alice', 'agent', root);
    let release: () => void = () => {},
      reached: () => void = () => {};
    const cleanupStarted = new Promise<void>((r) => {
      reached = r;
    });
    const runtime = new AgentRuntime(store, {
      beginUse: async () => config,
      model: {
        async complete() {
          return {
            message: { id: uuid(), role: 'assistant', content: 'done' },
            usage: { input: 0, output: 0 },
            finishReason: 'stop',
          };
        },
      },
      acquireWorkspace: async () => ({
        onLost() {},
        async release() {
          reached();
          await new Promise<void>((r) => {
            release = r;
          });
        },
      }),
    });
    try {
      runtime.prompt('alice', { sessionId: session.id, requestId: uuid(), text: 'finish' });
      const turnId = runtime.getTurn(session.id)!;
      await cleanupStarted;
      assert.equal(runtime.getTurn(session.id), undefined);
      assert.throws(
        () =>
          runtime.prompt('alice', {
            sessionId: session.id,
            requestId: uuid(),
            text: 'late steer',
            mode: 'steer',
            expectedTurnId: turnId,
          }),
        { code: 'TURN_CONFLICT' },
      );
      release();
      await runtime.wait(session.id);
      assert.equal(store.messages(session.id).filter((m) => m.role === 'user').length, 1);
    } finally {
      release();
      await runtime.close();
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

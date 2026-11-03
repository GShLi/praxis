import { AgentRuntime } from '@praxis/agent-runtime';
import { SessionStore } from '@praxis/storage-local';
import assert from 'node:assert/strict';
import test from 'node:test';

function fixture() {
  const store = new SessionStore(':memory:');
  const session = store.create('alice', 'agent', '/workspace');
  const runtime = new AgentRuntime(store, {
    interactive: true,
    model: {
      complete: async () => {
        throw new Error('no model call expected');
      },
    },
    beginUse: async () => {
      throw new Error('no credentials expected');
    },
  });
  return { store, session, runtime };
}

test('control questions preserve turn status and deduplicate durable answers after scope closure', async () => {
  const f = fixture();
  const control = f.runtime.interaction('alice', f.session.id);
  try {
    const pending = control.ask!([{ id: 'city', prompt: '城市' }], control.signal);
    const question = f.runtime.pendingQuestion(f.session.id)!;
    const response = {
      sessionId: f.session.id,
      questionId: question.questionId,
      turnId: question.turnId,
      answers: [{ id: 'city', text: 'Shanghai', skipped: false }],
    };
    assert.equal(f.store.get(f.session.id).status, 'idle');
    await assert.rejects(control.ask!([{ id: 'other', prompt: '其他' }], control.signal), {
      code: 'QUESTION_CONFLICT',
    });
    assert.deepEqual(f.runtime.answer('alice', response), { accepted: true });
    await pending;
    control.close();
    assert.deepEqual(f.runtime.answer('alice', response), { accepted: true });
    assert.throws(
      () => f.runtime.answer('alice', { ...response, answers: [{ id: 'city', text: 'Beijing' }] }),
      { code: 'ANSWER_CONFLICT' },
    );
    assert.throws(() => f.runtime.answer('bob', response), { code: 'SESSION_NOT_FOUND' });
    assert.equal(
      f.store.events(f.session.id).filter((e) => e.type === 'question/answered').length,
      1,
    );
    assert.equal(f.store.get(f.session.id).status, 'idle');
  } finally {
    control.close();
    await f.runtime.close();
    f.store.close();
  }
});

test('control cancellation closes questions and revokes unconsumed approval grants', async () => {
  const f = fixture();
  try {
    const first = f.runtime.interaction('alice', f.session.id);
    const waiting = first.ask!([{ id: 'city', prompt: '城市' }], first.signal);
    const stopped = assert.rejects(waiting, { code: 'CANCELLED' });
    first.close();
    await stopped;
    assert.equal(f.runtime.pendingQuestion(f.session.id), null);
    assert.equal(f.store.latestEvent(f.session.id, 'question/closed')?.payload.code, 'CANCELLED');
    const second = f.runtime.interaction('alice', f.session.id);
    const decision = second.approve(
      { callId: 'call', toolId: 'mcp.prompt', parameters: {}, reason: 'test' },
      second.signal,
    );
    const approval = f.runtime.approvals.snapshot(f.session.id)!;
    const response = {
      sessionId: f.session.id,
      turnId: approval.turnId,
      approvalId: approval.approvalId,
      requestHash: approval.requestHash,
      decision: 'approve-once',
    };
    f.runtime.approvals.respond('alice', response);
    const grant = await decision;
    await f.runtime.close();
    assert.throws(grant);
    assert.deepEqual(f.runtime.approvals.respond('alice', response), { accepted: true });
    assert.equal(f.store.get(f.session.id).status, 'idle');
  } finally {
    await f.runtime.close();
    f.store.close();
  }
});

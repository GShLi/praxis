import { ContextBuilder, protocolGroups } from '@praxis/context';
import type { Message, ModelConfig } from '@praxis/contracts';
import { SessionStore } from '@praxis/storage-local';
import assert from 'node:assert/strict';
import test from 'node:test';
import { calibrationModel } from './fixtures/calibration.ts';

const config: ModelConfig = {
  id: 'fixture',
  revision: 1,
  baseUrl: 'https://provider.invalid',
  model: 'fixture',
  apiKey: 'fixture-key',
  contextWindow: 16000,
  maxOutputTokens: 1000,
};
function tools(store: SessionStore, id: string, offset: number) {
  for (let i = offset; i < offset + 14; i++) {
    store.message(id, {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      toolCalls: [{ id: `call-${i}`, name: 'fixture', arguments: '{}' }],
    });
    store.message(id, {
      id: crypto.randomUUID(),
      role: 'tool',
      toolCallId: `call-${i}`,
      content: 'result '.repeat(400),
    });
  }
}
test('single-turn compactions preserve the exact current input across versions and switch pins for the next user input', async () => {
  const store = new SessionStore(':memory:');
  const session = store.create('owner', 'chat');
  const input: Message = {
    id: crypto.randomUUID(),
    role: 'user',
    content: '完成整个任务，不删除历史',
  };
  store.message(session.id, input);
  const context = new ContextBuilder(store, calibrationModel(0).model);
  const build = () =>
    context.build(session.id, [], [], config, new AbortController().signal, () => {});
  try {
    for (let round = 0; round < 2; round++) {
      tools(store, session.id, round * 14);
      const original = store.messages(session.id);
      const messages = await build();
      assert.deepEqual(
        messages.find((m) => m.id === input.id),
        input,
      );
      assert.equal(messages.filter((m) => m.id === input.id).length, 1);
      assert.equal(messages.at(-1)!.toolCallId, `call-${round * 14 + 13}`);
      assert.ok(store.context(session.id).version >= round + 1);
      protocolGroups(messages);
      assert.deepEqual(store.messages(session.id), original);
      assert.deepEqual(await build(), messages);
    }
    const next: Message = { id: crypto.randomUUID(), role: 'user', content: '改为新的要求' };
    store.message(session.id, next);
    tools(store, session.id, 28);
    const messages = await build();
    assert.deepEqual(
      messages.find((m) => m.id === next.id),
      next,
    );
    assert.equal(
      messages.some((m) => m.id === input.id),
      false,
    );
    assert.deepEqual(store.context(session.id).preservedMessageIds, [next.id]);
    assert.equal(store.messages(session.id).filter((m) => m.role === 'user').length, 2);
  } finally {
    store.close();
  }
});

test('a stale summary cannot publish over a newer context version', async () => {
  const store = new SessionStore(':memory:');
  const session = store.create('owner', 'chat');
  store.message(session.id, { id: 'u', role: 'user', content: 'finish' });
  tools(store, session.id, 0);
  let replace = true;
  const context = new ContextBuilder(store, {
    async complete(request) {
      if (replace) {
        replace = false;
        store.commitContext(
          session.id,
          0,
          { id: 'newer', role: 'user', content: 'new view' },
          'u',
          ['u'],
        );
      }
      return calibrationModel(0).model.complete(request);
    },
  });
  try {
    await assert.rejects(
      context.build(session.id, [], [], config, new AbortController().signal, () => {}),
      { code: 'CONTEXT_CONFLICT' },
    );
    assert.equal(store.context(session.id).summary!.id, 'newer');
    assert.equal(store.context(session.id).version, 1);
  } finally {
    store.close();
  }
});

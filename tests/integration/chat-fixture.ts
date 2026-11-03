import { ChatRuntime } from '@praxis/chat-runtime';
import type { Event } from '@praxis/contracts';
import type { ModelClient } from '@praxis/model-core';
import { UserInstructionRepository } from '@praxis/storage-server';
import { databaseFixture, provider } from './fixture.ts';

export const summary = {
  objective: '继续任务',
  requirements: [],
  decisions: [],
  completed: [],
  active: ['保留当前需求'],
  blocked: [],
  files: [],
  executions: [],
  nextActions: ['继续'],
  unresolvedQuestions: [],
};
export const model: ModelClient = {
  async complete(request) {
    request.signal.throwIfAborted();
    const content =
      request.purpose === 'compaction'
        ? JSON.stringify(summary)
        : '回答：' + request.messages.at(-1)?.content;
    request.onDelta(content);
    return {
      message: { id: crypto.randomUUID(), role: 'assistant', content },
      finishReason: 'stop',
      usage: { input: 10, output: 20 },
    };
  },
};
export async function chatFixture(client: ModelClient = model) {
  const f = await databaseFixture();
  const config = await f.auth.saveProvider(f.identity, provider, 'fixture-vendor-key');
  const instructions = new UserInstructionRepository(f.database);
  const runtime = new ChatRuntime(
    f.database,
    client,
    (_owner, id) => f.auth.beginUse(f.identity, id, false),
    { userInstructions: (owner) => instructions.read(owner) },
  );
  const chat = await runtime.create(f.identity.userId);
  return {
    ...f,
    runtime,
    chat,
    config,
    async close() {
      try {
        await runtime.close();
      } finally {
        await f.close();
      }
    },
  };
}
export function finished(runtime: ChatRuntime, sessionId: string) {
  return new Promise<Event>((resolve, reject) => {
    const timeout = setTimeout(() => {
      runtime.off('event', event);
      reject(new Error('Generation did not finish.'));
    }, 10000);
    const event = (value: Event) => {
      if (value.sessionId !== sessionId || value.type !== 'generation/finished') return;
      clearTimeout(timeout);
      runtime.off('event', event);
      resolve(value);
    };
    runtime.on('event', event);
  });
}

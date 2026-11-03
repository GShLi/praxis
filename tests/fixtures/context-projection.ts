import { ContextBuilder } from '@praxis/context';
import type { Message, ModelConfig } from '@praxis/contracts';
import { SessionStore } from '@praxis/storage-local';

const config: ModelConfig = {
  id: 'fixture',
  revision: 1,
  model: 'fixture',
  baseUrl: 'https://provider.invalid',
  apiKey: 'fixture-key',
  contextWindow: 16000,
  maxOutputTokens: 1000,
};
export function projectionFixture(database = ':memory:') {
  const store = new SessionStore(database);
  const session = store.create('owner', 'chat');
  const user: Message = { id: crypto.randomUUID(), role: 'user', content: '完成这个长任务' };
  store.message(session.id, user);
  for (let i = 0; i < 7; i++) {
    const remote = i === 0;
    store.message(session.id, {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      toolCalls: [{ id: `call-${i}`, name: remote ? 'mcp_fixture' : 'fs_read', arguments: '{}' }],
    });
    store.message(session.id, {
      id: crypto.randomUUID(),
      role: 'tool',
      toolCallId: `call-${i}`,
      content: JSON.stringify({
        callId: crypto.randomUUID(),
        toolId: remote ? 'mcp-fixture' : 'fs.read',
        toolVersion: 1,
        status: 'succeeded',
        effectState: remote ? 'unknown' : 'none',
        data: remote
          ? {
              origin: 'mcp',
              serverId: 'remote-server',
              catalogGeneration: 'catalog-1',
              protocolVersion: 'fixture',
              content: [{ type: 'text', text: 'x'.repeat(6000) }],
            }
          : {
              path: 'fixture.txt',
              fileVersion: 'version-1',
              eof: true,
              lines: [{ number: 1, text: 'x'.repeat(6000) }],
            },
        artifactIds: [],
        truncated: false,
        durationMs: 1,
      }),
    });
  }
  const context = new ContextBuilder(store, {
    async complete() {
      throw new Error('summary must not be called');
    },
  });
  return {
    store,
    session,
    user,
    context,
    build: (signal = new AbortController().signal) =>
      context.build(session.id, [], [], config, signal, () => {}),
  };
}

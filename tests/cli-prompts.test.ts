import { CliMcpPrompts } from '@praxis/cli/mcp-prompts';
import assert from 'node:assert/strict';
import test from 'node:test';

test('CLI preview releases input processing while MCP waits for an answer and rejects overlapping previews', async () => {
  let release!: () => void, arrived!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const errors: unknown[] = [];
  const prompts = new CliMcpPrompts(
    {
      rpc: {
        async request<T>(method: string): Promise<T> {
          if (method === 'mcp/prompt-list') return { generation: 'fixture' } as T;
          assert.equal(method, 'mcp/prompt-preview');
          arrived();
          await waiting;
          throw new Error('fixture cancellation');
        },
      },
    },
    'session',
    (error) => errors.push(error),
    () => {},
  );
  try {
    const command = '/mcp-preview server {"name":"fixture","arguments":{}}';
    assert.equal(await prompts.input(command), 'read');
    await ready;
    await assert.rejects(prompts.input(command), { code: 'MCP_BUSY' });
    // The caller can now process /cancel, form answers and /approve before the preview resolves.
    prompts.close();
    release();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(errors, []);
  } finally {
    prompts.close();
    release();
  }
});

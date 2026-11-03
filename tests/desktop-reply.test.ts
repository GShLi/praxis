import { PraxisError } from '@praxis/contracts';
import { desktopReply, readDesktopReply } from '@praxis/ui/client';
import assert from 'node:assert/strict';
import test from 'node:test';

test('desktop IPC preserves a safe domain error without Electron invocation prefixes or private causes', async () => {
  const reply = await desktopReply(() => {
    throw new PraxisError('MCP_PROTOCOL_FAILED', 'MCP 协议请求失败；未自动重放业务请求。');
  });
  assert.throws(() => readDesktopReply(reply), {
    code: 'MCP_PROTOCOL_FAILED',
    message: 'MCP 协议请求失败；未自动重放业务请求。',
  });
  const privateFailure = await desktopReply(async () => {
    throw new Error('fixture-private-key-and-path');
  });
  assert(!JSON.stringify(privateFailure).includes('fixture-private'));
  assert.throws(() => readDesktopReply(privateFailure), { code: 'INTERNAL_ERROR' });
});

test('desktop IPC returns unchanged successful values and rejects malformed envelopes without echoing them', async () => {
  for (const value of [null, undefined, { id: 'fixture', result: [] }])
    assert.deepEqual(readDesktopReply(await desktopReply(() => value)), value);
  for (const invalid of [null, { ok: true }, { ok: false, error: 'fixture-private' }])
    assert.throws(() => readDesktopReply(invalid), { code: 'DESKTOP_PROTOCOL_ERROR' });
});

import { startHost } from '@praxis/client-host';
import { approvalRequestSchema } from '@praxis/permissions';
import { pendingQuestionSchema, eventSchema } from '@praxis/contracts';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('Host shutdown is shared by concurrent callers and releases process listeners', async () => {
  const listeners = process.listenerCount('exit');
  const host = await startHost('cli');
  try {
    assert.ok(host.pid);
    await host.rpc.request('host/diagnostics');
    const one = host.close();
    assert.equal(one, host.close());
    await one;
    await host.close();
    assert.equal(process.listenerCount('exit'), listeners);
    assert.throws(() => process.kill(host.pid!, 0), { code: 'ESRCH' });
  } finally {
    await host.close();
  }
});

test('failed Host handshake reaps child before rejecting startup', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'praxis-handshake-'));
  const marker = path.join(directory, 'pid');
  const entry = path.join(directory, 'host.mjs');
  await writeFile(
    entry,
    `import { writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
writeFileSync(${JSON.stringify(marker)}, String(process.pid));
createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  process.stdout.write(JSON.stringify({ jsonrpc:'2.0', id:request.id, result:{major:-1, nonce:request.params.nonce} })+'\\n');
});`,
  );
  try {
    await assert.rejects(startHost('cli', {}, entry), { code: 'PROTOCOL_MISMATCH' });
    const pid = Number(await readFile(marker, 'utf8'));
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('interactive notification schemas reject malformed cross-process payloads', () => {
  assert.equal(
    pendingQuestionSchema.safeParse({ questionId: 'q', turnId: 't', questions: [] }).success,
    false,
  );
  assert.equal(approvalRequestSchema.safeParse({ approvalId: 'a', parameters: {} }).success, false);
  assert.equal(eventSchema.safeParse({ sessionId: 's', payload: [], seq: 1 }).success, false);
});

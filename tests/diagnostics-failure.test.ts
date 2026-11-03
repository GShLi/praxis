import { DiagnosticLog, exportDiagnostics } from '@praxis/diagnostics';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('disk-full logging failure notifies its owner once and does not expose the original error', async (t) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'praxis-log-disk-full-'));
  const failures: string[] = [],
    log = await DiagnosticLog.open(root, { onFailure: (code) => failures.push(code) });
  const original = fs.open;
  const mocked = t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    const [file, flags, mode] = args;
    if (String(file).endsWith('.jsonl'))
      throw Object.assign(new Error('private-key-in-error'), { code: 'ENOSPC' });
    return original(file, flags, mode);
  });
  syncBuiltinESMExports();
  try {
    for (let i = 0; i < 3; i++)
      log.record({ component: 'host', kind: 'request', phase: 'finished' });
    await log.flush();
    assert.deepEqual(failures, ['DISK_FULL']);
    assert.equal(log.status.errorCode, 'DISK_FULL');
    assert.equal(log.status.droppedRecords, 2);
    assert.ok(!JSON.stringify(log.status).includes('private-key-in-error'));
    await log.close();
    assert.equal((await exportDiagnostics(root, AbortSignal.timeout(5000))).records.length, 0);
  } finally {
    mocked.mock.restore();
    syncBuiltinESMExports();
    await log.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

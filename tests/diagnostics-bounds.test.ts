import { DiagnosticLog, exportDiagnostics, projectDiagnosticEvent } from '@praxis/diagnostics';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const input = { component: 'host', kind: 'request', phase: 'finished' } as const;

test('diagnostic queue rejects overflow and reports a failed writer without retaining error text', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-diagnostics-failure-'));
  const codes: string[] = [];
  const log = await DiagnosticLog.open(path.join(root, 'log'), {
    queueLimit: 1,
    onFailure: (code) => codes.push(code),
  });
  try {
    await rm(path.join(root, 'log'), { recursive: true });
    assert.equal(log.record(input), true);
    assert.equal(log.record(input), false);
    await log.flush();
    assert.equal(log.status.available, false);
    assert.deepEqual(codes, ['DIAGNOSTICS_WRITE_FAILED']);
    assert.equal(log.record(input), false);
    assert.equal(log.status.droppedRecords, 2);
  } finally {
    await log.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('diagnostic event projection retains execution metadata and classifies untrusted error codes', () => {
  const sessionId = randomUUID(),
    turnId = randomUUID(),
    callId = randomUUID();
  const projected = projectDiagnosticEvent({
    sessionId,
    seq: 1,
    type: 'tool/result',
    timestamp: new Date().toISOString(),
    eventId: randomUUID(),
    schemaVersion: 1,
    source: 'host',
    payload: {
      turnId,
      result: {
        callId,
        durationMs: 9,
        data: 'private contents',
        error: { code: 'PRIVATE_TOKEN_123', message: 'private contents' },
      },
    },
  });
  assert.equal(projected?.sessionId, sessionId);
  assert.equal(projected?.executionId, callId);
  assert.equal(projected?.code, 'UNCLASSIFIED_ERROR');
  assert.equal(projected?.phase, 'error');
  assert.ok(!JSON.stringify(projected).includes('PRIVATE_TOKEN'));
  assert.ok(!JSON.stringify(projected).includes('private contents'));
});

test('diagnostic export is bounded, excludes expired data and honors cancellation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-diagnostics-budget-'));
  const log = await DiagnosticLog.open(root);
  try {
    log.record(input);
    await log.close();
    const name = (await readdir(root))[0];
    assert(name);
    const line = await readFile(path.join(root, name), 'utf8');
    await writeFile(path.join(root, name), line.repeat(15000));
    const result = await exportDiagnostics(root, AbortSignal.timeout(5000));
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 2 * 1024 * 1024);
    assert.ok(result.records.length <= 5000 && result.records.length > 0);
    assert.equal(result.truncated, true);
    await rm(path.join(root, name));
    await writeFile(
      path.join(root, `diagnostics-${Date.now() - 15 * 86400000}-${randomUUID()}.jsonl`),
      line,
    );
    assert.equal((await exportDiagnostics(root, AbortSignal.timeout(5000))).records.length, 0);
    await assert.rejects(exportDiagnostics(root, AbortSignal.abort()), { name: 'AbortError' });
  } finally {
    await log.close();
    await rm(root, { recursive: true, force: true });
  }
});

import { DiagnosticLog, exportDiagnostics } from '@praxis/diagnostics';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { randomUUID } from 'node:crypto';

const record = {
  component: 'host' as const,
  kind: 'request' as const,
  phase: 'finished' as const,
  durationMs: 10,
};

test('diagnostics reject payloads, keep only approved metadata and close their writer', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-diagnostics-'));
  const log = await DiagnosticLog.open(root);
  try {
    assert.equal(log.record({ ...record, sessionId: randomUUID() }), true);
    for (const extra of [
      { prompt: 'private prompt' },
      { apiKey: 'fixture-secret' },
      { error: 'secret response' },
      { sessionId: 'fixture-secret' },
    ])
      assert.equal(log.record({ ...record, ...extra }), false);
    await log.flush();
    const result = await exportDiagnostics(root, AbortSignal.timeout(5000));
    assert.equal(result.records.length, 1);
    assert.ok(!JSON.stringify(result).includes('private prompt'));
    assert.ok(!JSON.stringify(result).includes('fixture-secret'));
    assert.equal(log.status.invalidRecords, 4);
    await log.close();
    assert.equal(log.record(record), false);
    if (process.platform !== 'win32') {
      const file = (await readdir(root))[0];
      assert(file);
      assert.equal((await stat(path.join(root, file))).mode & 0o777, 0o600);
    }
  } finally {
    await log.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('diagnostic rotation bounds file count and retires records older than fourteen days', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-diagnostics-rotate-'));
  const old = `diagnostics-${Date.now() - 15 * 86400000}-${randomUUID()}.jsonl`;
  await writeFile(path.join(root, old), 'expired diagnostic');
  const log = await DiagnosticLog.open(root, { maxFileBytes: 1024, maxFiles: 3 });
  try {
    for (let i = 0; i < 40; i++) {
      log.record({ ...record, durationMs: i });
      await log.flush();
    }
    const files = await readdir(root);
    assert.ok(files.length <= 3);
    assert.ok(!files.includes(old));
    const result = await exportDiagnostics(root, AbortSignal.timeout(5000));
    assert.equal(result.records.at(-1)?.durationMs, 39);
    assert.ok(result.records.length < 40);
    for (const file of files) assert.ok((await stat(path.join(root, file))).size <= 1024);
  } finally {
    await log.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('diagnostic exports omit invalid or partial lines and reject linked log files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-diagnostics-export-'));
  const log = await DiagnosticLog.open(root);
  try {
    log.record(record);
    await log.close();
    const name = (await readdir(root))[0];
    assert(name);
    const file = path.join(root, name),
      previous = await readFile(file, 'utf8');
    await writeFile(file, previous + '{"prompt":"fixture-secret"}\n{"partial":');
    const result = await exportDiagnostics(root, AbortSignal.timeout(5000));
    assert.equal(result.records.length, 1);
    assert.equal(result.excludedRecords, 2);
    assert.equal(result.truncated, true);
    assert.ok(!JSON.stringify(result).includes('fixture-secret'));
    const { link } = await import('node:fs/promises');
    await link(file, path.join(root, 'alias'));
    await assert.rejects(exportDiagnostics(root, AbortSignal.timeout(5000)), {
      code: 'DIAGNOSTICS_PATH',
    });
  } finally {
    await log.close();
    await rm(root, { recursive: true, force: true });
  }
});

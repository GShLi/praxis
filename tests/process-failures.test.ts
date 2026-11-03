import { ManagedProcesses } from '@praxis/tools/processes';
import { uuid } from '@praxis/storage-local';
import assert from 'node:assert/strict';
import test from 'node:test';
import { processFixture } from './fixtures/managed-process.ts';

test('command intent storage failure prevents starting and releases prepared resources', async () => {
  const f = processFixture();
  try {
    f.store.db.exec(`CREATE TRIGGER reject_intent BEFORE INSERT ON events
      WHEN json_extract(NEW.document,'$.type')='execution/intent'
      BEGIN SELECT RAISE(ABORT,'fixture storage failure'); END;`);
    await assert.rejects(f.service.execute(f.input, f.signal, f.session.permission));
    assert.equal(f.backend.calls.started, 0);
    assert.equal(f.backend.calls.closed, 1);
    assert.equal(f.store.matchingEvents(f.session.id, 'execution/intent', 10).length, 0);
  } finally {
    await assert.rejects(f.service.close(), { code: 'EXECUTION_RECORD_FAILED' });
    f.store.close();
  }
});

test('command approval binds current permission revision and exact tool call', async () => {
  const f = processFixture();
  let consumed = false;
  f.options.approve = async (request) => {
    assert.equal(request.callId, 'actual-tool-call');
    assert.equal(request.toolId, 'process.exec');
    assert.deepEqual((request.parameters as { args: string[] }).args, ['literal;value']);
    f.store.update(f.session.id, { permission: { ...f.session.permission, revision: 1 } });
    return () => {
      consumed = true;
    };
  };
  try {
    await assert.rejects(
      f.service.execute(f.input, f.signal, f.session.permission, 'actual-tool-call'),
      { code: 'APPROVAL_STALE' },
    );
    assert.equal(consumed, false);
    assert.equal(f.backend.calls.started, 0);
    assert.equal(f.backend.calls.closed, 1);
  } finally {
    await f.service.close();
    f.store.close();
  }
});

test('output persistence failure cancels execution, reports unknown and prevents later commands', async () => {
  const f = processFixture();
  try {
    const started = await f.service.execute(f.input, f.signal, f.session.permission);
    f.store.db.exec(`CREATE TRIGGER reject_output BEFORE INSERT ON artifacts
      BEGIN SELECT RAISE(ABORT,'fixture storage failure'); END;`);
    f.backend.output('stdout', 'must not report this as durable');
    assert.equal(f.failures.length, 1);
    f.backend.finish();
    await assert.rejects(f.service.close(), { code: 'EXECUTION_RECORD_FAILED' });
    assert.equal(f.backend.calls.stopped, 1);
    assert.equal(f.backend.calls.closed, 1);
    assert.equal(
      (
        await f.service.read(
          { executionId: started.executionId, maxBytes: 100, waitMs: 0 },
          f.signal,
        )
      ).processState,
      'unknown',
    );
    await assert.rejects(f.service.execute(f.input, f.signal, f.session.permission), {
      code: 'EXECUTION_CLOSED',
    });
  } finally {
    f.backend.finish();
    await f.service.close().catch(() => {});
    f.store.close();
  }
});

test('unconfirmed descendant cleanup cannot become success, even with exit zero', async () => {
  const f = processFixture();
  try {
    const started = await f.service.execute(f.input, f.signal, f.session.permission);
    f.backend.finish({ exitCode: 0, signal: null, cleanup: 'unknown' });
    const result = await f.service.read(
      { executionId: started.executionId, maxBytes: 100, waitMs: 1000 },
      f.signal,
    );
    assert.equal(result.processState, 'unknown');
    await assert.rejects(f.service.close(), { code: 'EXECUTION_CLEANUP_UNKNOWN' });
    assert.equal(f.failures.length, 1);
    await assert.rejects(f.service.cancel({ executionId: started.executionId }), {
      code: 'EXECUTION_CLEANUP_UNKNOWN',
    });
  } finally {
    f.backend.finish();
    await f.service.close().catch(() => {});
    f.store.close();
  }
});

test('interrupted execution exposes only committed output and never replays on a new turn', async () => {
  const f = processFixture();
  const restored = new ManagedProcesses({ ...f.options, turnId: uuid() });
  try {
    const started = await f.service.execute(f.input, f.signal, f.session.permission);
    f.backend.output('stdout', 'durable head');
    const recovered = await restored.read(
      { executionId: started.executionId, maxBytes: 100, waitMs: 0 },
      f.signal,
    );
    assert.equal(recovered.processState, 'unknown');
    assert.equal(recovered.outputTruncated, true);
    assert.equal(recovered.chunks[0]?.text, 'durable head');
    assert.equal(f.backend.calls.started, 1);
    await assert.rejects(restored.cancel({ executionId: started.executionId }), {
      code: 'EXECUTION_CLEANUP_UNKNOWN',
    });
  } finally {
    f.backend.finish();
    await f.service.close();
    await restored.close();
    f.store.close();
  }
});

test('timeout remains distinct from cancellation and reader cancellation does not kill a command', async () => {
  const f = processFixture();
  try {
    const started = await f.service.execute(
      { ...f.input, timeoutMs: 30 },
      f.signal,
      f.session.permission,
    );
    const reader = new AbortController();
    const reading = f.service.read(
      { executionId: started.executionId, waitMs: 1000, maxBytes: 100 },
      reader.signal,
    );
    reader.abort();
    await assert.rejects(reading);
    assert.equal(f.backend.calls.stopped, 0);
    await f.service.read(
      { executionId: started.executionId, waitMs: 1000, maxBytes: 100 },
      f.signal,
    );
    assert.equal(f.backend.calls.stopped, 1);
    f.backend.finish();
    const result = await f.service.read(
      { executionId: started.executionId, waitMs: 1000, maxBytes: 100 },
      f.signal,
    );
    assert.equal(result.processState, 'timed_out');
  } finally {
    f.backend.finish();
    await f.service.close();
    f.store.close();
  }
});

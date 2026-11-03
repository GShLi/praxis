import { ManagedProcesses } from '@praxis/tools/processes';
import { uuid } from '@praxis/storage-local';
import assert from 'node:assert/strict';
import test from 'node:test';
import { processFixture as setup } from './fixtures/managed-process.ts';

test('command service persists launch intent, returns running, then retains failed exit and output across turns', async () => {
  const f = setup();
  try {
    const started = await f.service.execute(f.input, f.signal, f.session.permission);
    assert.equal(started.processState, 'running');
    assert.equal(f.backend.calls.started, 1);
    assert(f.store.latestEvent(f.session.id, 'execution/intent', started.executionId));
    await assert.rejects(f.service.execute(f.input, f.signal, f.session.permission), {
      code: 'WORKSPACE_BUSY',
    });
    f.backend.output('stdout', 'Hello');
    f.backend.output('stderr', 'diagnostic');
    const first = await f.service.read(
      { executionId: started.executionId, waitMs: 0, maxBytes: 5 },
      f.signal,
    );
    assert.equal(first.chunks[0]?.text, 'Hello');
    f.backend.finish({ exitCode: 7, signal: null, cleanup: 'complete' });
    const finished = await f.service.read(
      { executionId: started.executionId, waitMs: 1000, maxBytes: 100 },
      f.signal,
    );
    assert.equal(finished.processState, 'failed');
    assert.equal(finished.exitCode, 7);
    assert.equal(f.backend.calls.closed, 1);
    const reopened = new ManagedProcesses({ ...f.options, turnId: uuid() });
    assert.deepEqual(
      await reopened.read({ executionId: started.executionId, waitMs: 0, maxBytes: 100 }, f.signal),
      finished,
    );
    assert.equal(reopened.list({ includeFinished: true, limit: 10 }).length, 1);
    await reopened.close();
    assert.equal(f.backend.calls.started, 1);
  } finally {
    f.backend.finish();
    await f.service.close();
    f.store.close();
  }
});

test('rejected approval releases prepared resources without spawning or publishing an execution', async () => {
  const f = setup(true);
  try {
    await assert.rejects(f.service.execute(f.input, f.signal, f.session.permission), {
      code: 'APPROVAL_REJECTED',
    });
    assert.equal(f.backend.calls.started, 0);
    assert.equal(f.backend.calls.closed, 1);
    assert.deepEqual(f.service.list({ includeFinished: true, limit: 10 }), []);
  } finally {
    await f.service.close();
    f.store.close();
  }
});

test('cancellation waits for cleanup and keeps its reason despite a subsequent successful exit code', async () => {
  const f = setup();
  try {
    const started = await f.service.execute(f.input, f.signal, f.session.permission);
    const cancelling = f.service.cancel({ executionId: started.executionId });
    assert.equal(f.service.active, true);
    const snapshot = await f.service.read(
      { executionId: started.executionId, waitMs: 0, maxBytes: 100 },
      f.signal,
    );
    assert.equal(snapshot.processState, 'cancelling');
    f.backend.finish();
    assert.equal((await cancelling).outcome, 'terminated');
    assert.equal(
      (
        await f.service.read(
          { executionId: started.executionId, waitMs: 0, maxBytes: 100 },
          f.signal,
        )
      ).processState,
      'cancelled',
    );
    assert.equal(
      (await f.service.cancel({ executionId: started.executionId })).outcome,
      'already_finished',
    );
    assert.equal(f.backend.calls.stopped, 1);
  } finally {
    f.backend.finish();
    await f.service.close();
    f.store.close();
  }
});

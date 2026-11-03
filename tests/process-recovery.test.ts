import { ManagedProcesses } from '@praxis/tools/processes';
import { SessionStore, uuid } from '@praxis/storage-local';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { processFixture } from './fixtures/managed-process.ts';

test('closing and reopening SQLite retains both output streams, final status and repeatable cursors', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'praxis-process-recovery-'));
  const database = path.join(directory, 'sessions.sqlite');
  const f = processFixture(false, database);
  try {
    const started = await f.service.execute(f.input, f.signal, f.session.permission);
    f.backend.output('stdout', '你好 Praxis\n');
    f.backend.output('stderr', 'warning\n');
    const first = await f.service.read(
      { executionId: started.executionId, maxBytes: 6, waitMs: 0 },
      f.signal,
    );
    f.backend.finish();
    await f.service.read(
      { executionId: started.executionId, maxBytes: 100, waitMs: 1000 },
      f.signal,
    );
    await f.service.close();
    f.store.close();
    const reopened = new SessionStore(database);
    const service = new ManagedProcesses({ ...f.options, store: reopened, turnId: uuid() });
    try {
      const rest = await service.read(
        { executionId: started.executionId, cursor: first.nextCursor, maxBytes: 100, waitMs: 0 },
        f.signal,
      );
      assert.equal(rest.processState, 'succeeded');
      assert.deepEqual(
        rest.chunks.map((chunk) => [chunk.stream, chunk.text]),
        [
          ['stdout', ' Praxis\n'],
          ['stderr', 'warning\n'],
        ],
      );
      assert.equal(f.backend.calls.started, 1);
      assert.equal(service.list({ includeFinished: true, limit: 10 }).length, 1);
      const other = reopened.create('fixture', 'agent', '/fixture/other');
      const isolated = new ManagedProcesses({ ...f.options, store: reopened, sessionId: other.id });
      await assert.rejects(
        isolated.read({ executionId: started.executionId, maxBytes: 100, waitMs: 0 }, f.signal),
        { code: 'EXECUTION_NOT_FOUND' },
      );
      await isolated.close();
    } finally {
      await service.close();
      reopened.close();
    }
  } finally {
    f.backend.finish();
    await f.service.close();
    if (f.store.db.isOpen) f.store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

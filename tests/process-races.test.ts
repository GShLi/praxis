import assert from 'node:assert/strict';
import test from 'node:test';
import { processFixture } from './fixtures/managed-process.ts';

test('cancellation after intent commit but before backend startup does not dispatch user code', async () => {
  const f = processFixture(),
    controller = new AbortController();
  f.store.on('event', (event) => {
    if (event.type === 'execution/intent') controller.abort();
  });
  try {
    await assert.rejects(f.service.execute(f.input, controller.signal, f.session.permission));
    assert.equal(f.backend.calls.started, 0);
    assert.equal(f.backend.calls.closed, 1);
    assert.equal(f.service.active, false);
    const result = f.service.list({ includeFinished: true, limit: 10 });
    assert.equal(result[0]?.processState, 'cancelled');
    assert.equal(f.store.latestEvent(f.session.id, 'execution/started'), undefined);
  } finally {
    f.backend.finish();
    await f.service.close();
    f.store.close();
  }
});

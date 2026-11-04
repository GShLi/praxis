import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectDesktopCloseActivity } from './desktop-close-fixture.ts';

test('inspection queries owned Host sessions and counts all four active statuses once', async () => {
  const requests: unknown[][] = [];
  const result = await inspectDesktopCloseActivity({
    request: async (...args) => {
      requests.push(args);
      return [
        'idle',
        'running',
        'waiting_input',
        'waiting_approval',
        'cancelling',
        'completed',
        'cancelled',
        'failed',
        'interrupted',
      ].map((status, index) => ({ id: `s${index}`, status }));
    },
  });
  assert.deepEqual(result, { kind: 'known', activeCount: 4 });
  assert.deepEqual(requests, [['session/list', { includeArchived: true }, 3000]]);
});

test('no acquired Host, including startup failure, needs no task warning', async () => {
  assert.deepEqual(await inspectDesktopCloseActivity(undefined), { kind: 'known', activeCount: 0 });
});

test('a saturated history page cannot establish the total active count', async () => {
  for (const status of ['idle', 'running']) {
    const sessions = Array.from({ length: 100 }, (_, index) => ({ id: `s${index}`, status }));
    assert.deepEqual(await inspectDesktopCloseActivity({ request: async () => sessions }), {
      kind: 'unknown',
    });
  }
});

test('connection failure and unbound identity remain unknown rather than invented zero counts', async () => {
  for (const code of ['CONNECTION_CLOSED', 'RPC_TIMEOUT', 'UNAUTHENTICATED']) {
    assert.deepEqual(
      await inspectDesktopCloseActivity({
        request: async () => {
          throw Object.assign(new Error('private error'), { code });
        },
      }),
      { kind: 'unknown' },
    );
  }
});

test('malformed session snapshots cannot silently hide active work', async () => {
  for (const result of [
    null,
    {},
    [null],
    [{ id: 's' }],
    [{ id: 's', status: 'future-status' }],
    [{ id: '', status: 'idle' }],
    [
      { id: 's', status: 'running' },
      { id: 's', status: 'idle' },
    ],
  ]) {
    assert.deepEqual(await inspectDesktopCloseActivity({ request: async () => result }), {
      kind: 'unknown',
    });
  }
  assert.deepEqual(await inspectDesktopCloseActivity({ request: async () => [] }), {
    kind: 'known',
    activeCount: 0,
  });
});

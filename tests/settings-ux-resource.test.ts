import assert from 'node:assert/strict';
import { test } from 'node:test';

// Test the internal controller directly without adding a production package export for tests.
const { SettingsResource } = await import(
  new URL('../packages/ui/src/settings/settings-resource.ts', import.meta.url).href
);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

test('settings lists distinguish loading, failed reads, and a successful empty retry', async () => {
  let fail = true;
  const list = new SettingsResource(async () => {
    if (fail) throw new Error('offline');
    return [];
  });
  list.activate();
  assert.equal(list.getSnapshot().status, 'loading');
  assert.equal(await list.reload(), false);
  assert.equal(list.getSnapshot().status, 'error');
  assert.equal(list.getSnapshot().data, null);
  fail = false;
  assert.equal(await list.reload(), true);
  assert.equal(list.getSnapshot().status, 'ready');
  assert.deepEqual(list.getSnapshot().data, []);
  list.dispose();
});

test('a disposed list cannot publish a late load or clear a new operation lock', async () => {
  const first = deferred<number[]>(),
    second = deferred<number[]>();
  let reads = 0;
  const list = new SettingsResource(() => (++reads === 1 ? first.promise : second.promise));
  list.activate();
  const old = list.reload();
  list.dispose();
  list.activate();
  const current = list.reload();
  first.resolve([1]);
  assert.equal(await old, false);
  assert.equal(list.getSnapshot().data, null);
  assert.equal(list.getSnapshot().busy, true);
  second.resolve([2]);
  assert.equal(await current, true);
  assert.deepEqual(list.getSnapshot().data, [2]);
  list.dispose();
});

test('duplicate writes and reloads are rejected until the write and refresh settle', async () => {
  const write = deferred<string>();
  const list = new SettingsResource(async () => ({ revision: 1 }));
  list.activate();
  await list.reload();
  let writes = 0;
  const save = () => {
    writes++;
    return write.promise;
  };
  const pending = list.run(save);
  assert.equal(await list.run(save), false);
  assert.equal(await list.reload(), false);
  write.resolve('saved');
  assert.equal(await pending, true);
  assert.equal(writes, 1);
  assert.equal(list.getSnapshot().feedback.variant, 'success');
  list.dispose();
});

test('unmounted writes never publish success or trigger a refresh', async () => {
  const write = deferred<string>();
  let reads = 0;
  const list = new SettingsResource(async () => {
    reads++;
    return [];
  });
  list.activate();
  await list.reload();
  const pending = list.run(() => write.promise);
  list.dispose();
  write.resolve('must not appear');
  assert.equal(await pending, false);
  assert.equal(reads, 1);
  assert.equal(list.getSnapshot().feedback.message, '');
});

test('failed writes retain error feedback even after an authoritative refresh', async () => {
  const list = new SettingsResource(async () => ({ revision: 3 }));
  list.activate();
  await list.reload();
  assert.equal(
    await list.run(async () => {
      throw new Error('revision conflict');
    }, 'server'),
    false,
  );
  assert.equal(list.getSnapshot().feedback.variant, 'error');
  assert.equal(list.getSnapshot().feedback.target, 'server');
  assert.equal(list.getSnapshot().feedback.message, 'revision conflict');
  assert.equal(list.getSnapshot().data.revision, 3);
  list.dispose();
});

test('committed writes with failed refresh report partial success and require a read retry', async () => {
  let reads = 0;
  const list = new SettingsResource(async () => {
    if (++reads === 2) throw new Error('offline');
    return { revision: reads };
  });
  list.activate();
  await list.reload();
  assert.equal(await list.run(async () => '连接已保存。'), true);
  assert.equal(list.getSnapshot().status, 'error');
  assert.equal(list.getSnapshot().feedback.variant, 'error');
  assert.match(list.getSnapshot().feedback.message, /连接已保存.*列表刷新失败/);
  let writes = 0;
  assert.equal(
    await list.run(async () => {
      writes++;
      return 'unexpected';
    }),
    false,
  );
  assert.equal(writes, 0);
  assert.equal(await list.reload(), true);
  assert.equal(list.getSnapshot().data.revision, 3);
  assert.equal(list.getSnapshot().feedback.message, '');
  list.dispose();
});

test('missing list capabilities cannot produce an empty or successful state', async () => {
  const list = new SettingsResource(undefined);
  list.activate();
  assert.equal(list.getSnapshot().status, 'unsupported');
  assert.equal(await list.reload(), false);
  assert.equal(await list.run(async () => 'saved'), false);
  list.dispose();
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { readFile, symlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { macosIsolationFixture } from './macos-isolation-fixture.ts';

let fixture: Awaited<ReturnType<typeof macosIsolationFixture>>;
before(async () => {
  fixture = await macosIsolationFixture();
});
after(async () => {
  await fixture?.close();
});

test('macOS Seatbelt allows workspace reads and refuses outside files and symlink targets', async () => {
  assert.equal(fixture.run('read', path.join(fixture.workspace, 'input.txt')), 0);
  assert.equal(fixture.run('read', fixture.outside), 10);
  const link = path.join(fixture.workspace, 'outside-link');
  await symlink(fixture.outside, link);
  assert.equal(fixture.run('read', link), 10);
});

test('macOS Seatbelt differentiates read-only and writable workspace while allowing private scratch', async () => {
  const input = path.join(fixture.workspace, 'input.txt');
  assert.equal(fixture.run('write', input), 10);
  assert.equal(await readFile(input, 'utf8'), 'disposable workspace fixture');
  assert.equal(fixture.run('write', path.join(fixture.temporary, 'scratch.txt')), 0);
  assert.equal(fixture.run('write', input, true), 0);
  assert.equal(await readFile(input, 'utf8'), 'disposable workspace fixturex');
  assert.equal(fixture.run('write', fixture.outside, true), 10);
});

test('macOS Seatbelt restrictions survive fork and exec in a child', () => {
  assert.equal(fixture.run('child-read', path.join(fixture.workspace, 'input.txt')), 0);
  assert.equal(fixture.run('child-read', fixture.outside), 10);
});

test('macOS Seatbelt denies loopback TCP and pathname Unix sockets that work outside isolation', async () => {
  const tcp = createServer((socket) => socket.destroy());
  const unix = createServer((socket) => socket.destroy());
  try {
    tcp.listen(0, '127.0.0.1');
    await once(tcp, 'listening');
    const socketPath = path.join(fixture.temporary, 'host.sock');
    unix.listen(socketPath);
    await once(unix, 'listening');
    const address = tcp.address();
    assert(address && typeof address === 'object');
    for (const [operation, target] of [
      ['tcp', String(address.port)],
      ['unix', socketPath],
    ] as const) {
      const baseline = spawnSync(fixture.binary, [operation, target], { timeout: 5000 });
      assert.ifError(baseline.error);
      assert.equal(baseline.status, 0, 'Fixture socket must work without sandbox restrictions.');
      assert.equal(fixture.run(operation, target), 10);
    }
  } finally {
    await Promise.all(
      [tcp, unix].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    );
  }
});

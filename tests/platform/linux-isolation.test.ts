import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { readlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { namespaceMembers, runIsolated, startIsolatedHost } from './linux-isolation-fixture.ts';

test('Linux mechanism isolates namespaces, inherited environment, mounts and temporary writes', async () => {
  const hostPid = await readlink('/proc/self/ns/pid');
  const hostNet = await readlink('/proc/self/ns/net');
  const output = runIsolated(
    `import errno, os, sys
assert os.readlink('/proc/self/ns/pid') != sys.argv[1]
assert os.readlink('/proc/self/ns/net') != sys.argv[2]
assert not os.path.exists(sys.argv[3])
assert not os.path.exists('/run')
assert not os.path.exists('/sys')
assert 'PRAXIS_PROBE_FAKE_SECRET' not in os.environ
assert not os.path.exists('/proc/1/root' + sys.argv[3])
assert os.statvfs('/usr').f_flag & os.ST_RDONLY
with open('/tmp/praxis-probe', 'w') as file: file.write('temporary')
with open('/tmp/praxis-probe') as file: assert file.read() == 'temporary'
try:
    fd = os.open('/usr/praxis-probe-must-not-exist', os.O_CREAT|os.O_EXCL|os.O_WRONLY, 0o600)
except OSError as error:
    assert error.errno in (errno.EROFS, errno.EACCES)
else:
    os.close(fd)
    os.unlink('/usr/praxis-probe-must-not-exist')
    raise AssertionError('system mount was writable')
print('isolated')`,
    [hostPid, hostNet, homedir()],
  );
  assert.equal(output, 'isolated');
});

test('Linux network namespace denies host TCP and abstract Unix sockets', async () => {
  const tcp = createServer((socket) => socket.destroy());
  const unix = createServer((socket) => socket.destroy());
  const abstractName = `\0praxis-probe-${process.pid}`;
  try {
    tcp.listen(0, '127.0.0.1');
    await once(tcp, 'listening');
    unix.listen(abstractName);
    await once(unix, 'listening');
    const address = tcp.address();
    assert(address && typeof address !== 'string');
    const output = runIsolated(
      `import socket, sys
for family, address in [(socket.AF_INET, ('127.0.0.1', int(sys.argv[1]))), (socket.AF_UNIX, '\\0' + sys.argv[2])]:
    with socket.socket(family) as connection:
        connection.settimeout(1)
        assert connection.connect_ex(address) != 0
print('denied')`,
      [String(address.port), abstractName.slice(1)],
    );
    assert.equal(output, 'denied');
  } finally {
    await Promise.all(
      [tcp, unix].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    );
  }
});

const descendants = `import os, time
r,w=os.pipe()
if os.fork() == 0:
    os.close(r)
    os.setsid()
    if os.fork() == 0:
        os.write(w, b'1')
        os.close(w)
        time.sleep(10)
    os._exit(0)
os.close(w)
os.read(r,1)
os.close(r)
print(os.readlink('/proc/self/ns/pid'), flush=True)
time.sleep(10)
`;

test('Linux Host SIGKILL removes the namespace including double-fork setsid descendants', async () => {
  const fixture = await startIsolatedHost(descendants);
  try {
    assert((await namespaceMembers(fixture.namespace)).length >= 3);
    fixture.host.kill('SIGKILL');
    const deadline = performance.now() + 3000;
    let members = await namespaceMembers(fixture.namespace);
    while (members.length && performance.now() < deadline) {
      await delay(20);
      members = await namespaceMembers(fixture.namespace);
    }
    assert.deepEqual(members, [], 'Detached processes must not survive Host death.');
    // close also waits for stdout/stderr EOF from every process that inherited the pipes.
    await fixture.closed;
  } finally {
    await fixture.close();
  }
});

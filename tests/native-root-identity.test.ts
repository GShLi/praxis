import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { windowsDirectoryIdentity } from './fixtures/native-root-identity.ts';
import { nativeRootIdentity } from '@praxis/tools/files/root-identity';

test('Windows root identity matches the native DWORD serial across libuv versions', () => {
  const ino = 0x20000000000001n;
  const oldStat = { dev: 0x12345678fedcba98n, ino };
  const newStat = { dev: 0xfedcba98n, ino };
  assert.equal(nativeRootIdentity(oldStat, 'win32'), `4275878552:${ino}`);
  assert.equal(nativeRootIdentity(oldStat, 'win32'), nativeRootIdentity(newStat, 'win32'));
  assert.notEqual(
    nativeRootIdentity(oldStat, 'win32'),
    nativeRootIdentity({ ...oldStat, dev: oldStat.dev + 1n }, 'win32'),
  );
  assert.notEqual(
    nativeRootIdentity(oldStat, 'win32'),
    nativeRootIdentity({ ...oldStat, ino: ino + 1n }, 'win32'),
  );
});

test('POSIX root identity retains the entire device and inode values', () => {
  const stat = { dev: 0x12345678fedcba98n, ino: 0x20000000000001n };
  for (const platform of ['darwin', 'linux'] as const) {
    assert.equal(nativeRootIdentity(stat, platform), `${stat.dev}:${stat.ino}`);
  }
});

test(
  'Windows temporary directory identity matches GetFileInformationByHandle',
  {
    skip: process.platform !== 'win32',
    timeout: 45_000,
  },
  async () => {
    const temporary = await mkdtemp(path.join(tmpdir(), 'praxis-root-identity-'));
    try {
      const directory = await realpath(temporary);
      const info = await stat(directory, { bigint: true });
      const native = await windowsDirectoryIdentity(directory);
      assert.equal(
        nativeRootIdentity(info),
        native,
        `fs.stat bigint dev:ino = ${info.dev}:${info.ino}`,
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  },
);

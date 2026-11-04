import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { tarExecutable } from '../scripts/release/archive.ts';
import { run } from '../scripts/release/process.ts';

test('Windows release archives use System32 tar instead of Git Bash PATH tar', () => {
  assert.equal(tarExecutable('win32', 'C:\\Windows'), 'C:\\Windows\\System32\\tar.exe');
  assert.equal(
    tarExecutable('win32', 'D:\\Windows Directory\\'),
    'D:\\Windows Directory\\System32\\tar.exe',
  );
});

test('Windows release archives reject a missing or relative SystemRoot', () => {
  assert.throws(() => tarExecutable('win32', ''), /SystemRoot/);
  assert.throws(() => tarExecutable('win32', 'Windows'), /SystemRoot/);
});

test('macOS and Linux release archives keep their existing tar command', () => {
  assert.equal(tarExecutable('darwin', ''), 'tar');
  assert.equal(tarExecutable('linux', ''), 'tar');
});

test('release tar creates and extracts absolute archive paths containing spaces', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'praxis release archive-'));
  try {
    const source = path.join(root, 'source directory');
    const destination = path.join(root, 'installed directory');
    const archive = path.join(root, 'release archive.tar.gz');
    await mkdir(path.join(source, 'cli'), { recursive: true });
    await mkdir(destination);
    await writeFile(path.join(source, 'cli/payload.txt'), 'relocated CLI payload\n');
    // An empty Windows PATH proves both operations use the native absolute executable.
    const options = process.platform === 'win32' ? { env: { ...process.env, PATH: '' } } : {};
    await run(tarExecutable(), ['-czf', archive, '-C', source, 'cli'], options);
    await run(tarExecutable(), ['-xzf', archive, '-C', destination], options);
    assert.equal(
      await readFile(path.join(destination, 'cli/payload.txt'), 'utf8'),
      'relocated CLI payload\n',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

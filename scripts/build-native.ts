import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
const directory = path.resolve('build/native');
mkdirSync(directory, { recursive: true });
const result =
  process.platform === 'win32'
    ? spawnSync(
        'cl',
        [
          '/nologo',
          '/W4',
          '/O2',
          'native/lease.c',
          `/Fe:${path.join(directory, 'praxis-lease.exe')}`,
          `/Fo:${path.join(directory, 'lease.obj')}`,
        ],
        { stdio: 'inherit' },
      )
    : spawnSync(
        'cc',
        [
          '-Wall',
          '-Wextra',
          '-Werror',
          '-O2',
          'native/lease.c',
          '-o',
          path.join(directory, 'praxis-lease'),
        ],
        { stdio: 'inherit' },
      );
if (result.status !== 0) {
  console.error('Native lease helper build failed. Install the platform C toolchain.');
  process.exitCode = 1;
}

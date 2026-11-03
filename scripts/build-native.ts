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

if (process.exitCode !== 1) {
  const files =
    process.platform === 'win32'
      ? spawnSync(
          'cl',
          [
            '/nologo',
            '/W4',
            '/O2',
            '/D_CRT_SECURE_NO_WARNINGS',
            '/D_WIN32_WINNT=0x0A00',
            'native/files/main.c',
            'native/files/protocol.c',
            'native/files/win-handles.c',
            'native/files/win-path.c',
            'native/files/win-read.c',
            'native/files/win-write.c',
            `/Fe:${path.join(directory, 'praxis-files.exe')}`,
            `/Fo:${directory}${path.sep}`,
            'Bcrypt.lib',
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
            'native/files/main.c',
            'native/files/protocol.c',
            'native/files/path.c',
            'native/files/read.c',
            'native/files/write.c',
            '-o',
            path.join(directory, 'praxis-files'),
          ],
          { stdio: 'inherit' },
        );
  if (files.status !== 0) {
    console.error('Native file helper build failed. Install the platform C toolchain.');
    process.exitCode = 1;
  }
}

if (process.exitCode !== 1 && process.platform !== 'linux') {
  const secret =
    process.platform === 'win32'
      ? spawnSync(
          'cl',
          [
            '/nologo',
            '/W4',
            '/O2',
            'native/secret-store-win.c',
            `/Fe:${path.join(directory, 'praxis-secret.exe')}`,
            `/Fo:${path.join(directory, 'secret.obj')}`,
            'Advapi32.lib',
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
            '-fobjc-arc',
            'native/secret-store.m',
            '-framework',
            'Foundation',
            '-framework',
            'Security',
            '-framework',
            'LocalAuthentication',
            '-o',
            path.join(directory, 'praxis-secret'),
          ],
          { stdio: 'inherit' },
        );
  if (secret.status !== 0) {
    console.error('Native credential helper build failed. Install the platform SDK.');
    process.exitCode = 1;
  }
}

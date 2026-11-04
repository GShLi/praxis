import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import electron from 'electron';

// Requires the local Web/backend services at 4311/4310 and a display environment.
test(
  'real Web startup reaches login without cookies and recovers after a network failure',
  {
    skip: process.env.PRAXIS_WEB_STARTUP_TESTS !== '1',
    timeout: 60000,
  },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'praxis-startup-'));
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    try {
      const result = await promisify(execFile)(
        String(electron),
        ['tests/fixtures/web-startup.cjs', directory],
        { env, timeout: 45000, maxBuffer: 1024 * 1024 },
      );
      assert.match(result.stdout, /WEB_STARTUP_OK/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

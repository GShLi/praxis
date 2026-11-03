import { DiagnosticLog } from '@praxis/diagnostics';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
const execute = promisify(execFile);

test('server maintenance CLI exports its explicit log directory without connecting to a database', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-diagnostics-admin-'));
  const directory = path.join(root, 'log'),
    log = await DiagnosticLog.open(directory);
  try {
    log.record({ component: 'server', kind: 'request', phase: 'finished', httpStatus: 200 });
    await log.close();
    const env = {
      ...process.env,
      PRAXIS_SERVER_LOG_DIR: directory,
      PRAXIS_DATABASE_URL: '',
      PRAXIS_MASTER_KEY: '',
    };
    const result = await execute(
      process.execPath,
      ['--import', 'tsx', 'apps/server/src/main.ts', 'export-diagnostics', root],
      { env, timeout: 10000 },
    );
    const saved = JSON.parse(result.stdout) as { file: string; records: number };
    assert.equal(saved.records, 1);
    assert.equal(JSON.parse(await readFile(saved.file, 'utf8')).records[0].httpStatus, 200);
    const before = await readdir(root);
    await assert.rejects(
      execute(
        process.execPath,
        ['--import', 'tsx', 'apps/server/src/main.ts', 'export-diagnostics'],
        { env, timeout: 10000 },
      ),
      /INVALID_ARGUMENT/,
    );
    assert.deepEqual(await readdir(root), before);
  } finally {
    await log.close();
    await rm(root, { recursive: true, force: true });
  }
});

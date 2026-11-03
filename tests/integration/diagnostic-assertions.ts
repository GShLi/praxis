import type { startHost } from '@praxis/client-host';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
const execute = promisify(execFile);

export async function checkDiagnosticExport(
  root: string,
  env: NodeJS.ProcessEnv,
  host?: Awaited<ReturnType<typeof startHost>>,
) {
  if (host) {
    const value = await host.rpc.request<Record<string, unknown>>('host/diagnostics-export');
    assert.equal(value.format, 'praxis-diagnostics');
    assert.ok(Array.isArray(value.records) && value.records.length > 0);
    assert.ok(!JSON.stringify(value).includes(env.PRAXIS_API_KEY ?? 'missing-key'));
  }
  const result = await execute(
    process.execPath,
    ['--import', 'tsx', 'apps/cli/src/main.ts', 'data', 'export-diagnostics', root],
    { env: { ...process.env, ...env }, timeout: 15000 },
  );
  const saved = JSON.parse(result.stdout) as { file: string; records: number };
  assert.ok(saved.records > 0);
  const text = await readFile(saved.file, 'utf8');
  for (const secret of [
    env.PRAXIS_API_KEY,
    'fixture-vendor-key',
    '<h1>Hello World！！！</h1>',
    root,
  ])
    if (secret) assert.ok(!text.includes(secret));
  if (process.platform !== 'win32') assert.equal((await stat(saved.file)).mode & 0o777, 0o600);
  return JSON.parse(text) as { records: Array<{ kind: string }> };
}

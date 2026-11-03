import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { cliDistribution } from '../fixtures/cli-distribution.ts';
const execute = promisify(execFile);

export async function checkRelocatedCli(root: string, identity: Record<string, string>) {
  const entry = await cliDistribution(root);
  const workspace = path.join(root, 'relocated-workspace');
  await mkdir(workspace);
  const env: NodeJS.ProcessEnv = { ...process.env, ...identity, PRAXIS_SECRET_STORE: 'memory' };
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  delete env.PRAXIS_NATIVE_DIR;
  const cli = (...args: string[]) =>
    execute(process.execPath, [entry, ...args], {
      cwd: workspace,
      env,
      timeout: 20000,
      maxBuffer: 1024 * 1024,
    });
  const before = JSON.parse((await cli('sessions')).stdout) as Array<{ id: string }>;
  const result = await cli('run', '--workspace', workspace, '--command', 'fixture.cli/hello');
  assert.match(result.stdout, /completed/);
  assert.ok(!result.stdout.includes(identity.PRAXIS_API_KEY!));
  assert.equal(
    await readFile(path.join(workspace, 'hello.html'), 'utf8'),
    '<h1>Hello World！！！</h1>',
  );
  const after = JSON.parse((await cli('sessions')).stdout) as Array<{ id: string }>;
  assert.equal(after.length, before.length + 1);
  for (const session of before) assert.ok(after.some((item) => item.id === session.id));
  const saved = JSON.parse((await cli('data', 'backup', root)).stdout) as { directory: string };
  const inspected = JSON.parse((await cli('data', 'inspect', saved.directory)).stdout);
  assert.equal(inspected.counts.sessions, after.length);
  assert.ok(!JSON.stringify(inspected).includes(identity.PRAXIS_API_KEY!));
}

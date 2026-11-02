import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { localCluster } from './postgres/cluster.ts';

async function main() {
  const bin = process.env.PRAXIS_TEST_PG_BIN;
  const external = process.env.PRAXIS_TEST_DATABASE_URL;
  if (!bin && !external)
    throw new Error(
      'Set PRAXIS_TEST_PG_BIN to local PostgreSQL bin, or PRAXIS_TEST_DATABASE_URL to a dedicated test server.',
    );
  const controller = new AbortController();
  let child: ReturnType<typeof spawn> | undefined;
  let cluster: Awaited<ReturnType<typeof localCluster>> | undefined;
  const stop = () => {
    controller.abort();
    child?.kill('SIGTERM');
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    cluster = bin ? await localCluster(path.resolve(bin), controller.signal) : undefined;
    controller.signal.throwIfAborted();
    const files = (await readdir('tests/integration'))
      .filter((file) => file.endsWith('.test.ts'))
      .map((file) => 'tests/integration/' + file);
    child = spawn(process.execPath, ['--import', 'tsx', '--test', ...files], {
      stdio: 'inherit',
      env: { ...process.env, PRAXIS_TEST_DATABASE_URL: cluster?.url ?? external },
    });
    const testProcess = child;
    process.exitCode = await new Promise<number>((resolve, reject) => {
      testProcess.once('error', reject);
      testProcess.once('exit', (code) => resolve(code ?? 1));
    });
  } finally {
    try {
      await cluster?.close();
    } finally {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    }
  }
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'PostgreSQL integration failed.');
  process.exitCode = 1;
});

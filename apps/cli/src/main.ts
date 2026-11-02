import { safeError } from '@praxis/contracts';
import { runCli } from './run-cli.ts';
runCli().catch((error: unknown) => {
  const e = safeError(error);
  console.error(`${e.code}: ${e.safeMessage}`);
  process.exitCode = 1;
});

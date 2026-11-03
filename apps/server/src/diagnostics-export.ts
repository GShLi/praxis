import { assert } from '@praxis/contracts';
import { saveDiagnosticExport } from '@praxis/diagnostics';
import path from 'node:path';
import { serverConfig } from './config.ts';
import { serverDiagnosticDirectory } from './diagnostics-path.ts';

/** Local administrator command, requiring OS access to the service's private directory. */
export async function exportServerDiagnostics(destination?: string) {
  assert(destination, 'INVALID_ARGUMENT', '请指定现有的诊断导出目录。');
  const scope = new AbortController(),
    stop = () => scope.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const report = await saveDiagnosticExport(
      serverDiagnosticDirectory(serverConfig().origin),
      path.resolve(destination),
      scope.signal,
    );
    console.log(JSON.stringify(report));
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}

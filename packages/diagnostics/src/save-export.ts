import { assert } from '@praxis/contracts';
import { randomUUID } from 'node:crypto';
import { lstat, open, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { exportDiagnostics } from './export.ts';

/** Explicit maintenance action; never called from a model tool or automatic telemetry. */
export async function saveDiagnosticExport(
  directory: string,
  destination: string,
  signal: AbortSignal,
) {
  const report = await exportDiagnostics(directory, signal);
  const stat = await lstat(destination);
  assert(
    stat.isDirectory() && !stat.isSymbolicLink(),
    'DIAGNOSTICS_PATH',
    '请选择现有的普通导出目录。',
  );
  const file = path.join(await realpath(destination), `praxis-diagnostics-${randomUUID()}.json`);
  signal.throwIfAborted();
  const handle = await open(file, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(report) + '\n', { encoding: 'utf8', signal });
    await handle.sync();
    signal.throwIfAborted();
  } catch (error) {
    await unlink(file);
    throw error;
  } finally {
    await handle.close();
  }
  return {
    file,
    records: report.records.length,
    truncated: report.truncated,
    excludedRecords: report.excludedRecords,
  };
}

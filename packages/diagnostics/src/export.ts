import { logFiles, readLogTail } from './files.ts';
import { MAX_EXPORT_BYTES, MAX_EXPORT_RECORDS } from './schema.ts';
import { ExportRecords } from './export-records.ts';

/** A read-only bounded snapshot; revalidate every record so a damaged log cannot export arbitrary content. */
export async function exportDiagnostics(directory: string, cancellation: AbortSignal) {
  const signal = AbortSignal.any([cancellation, AbortSignal.timeout(10000)]);
  signal.throwIfAborted();
  const files = (await logFiles(directory)).filter(
    (item) => Date.now() - item.createdAt < 14 * 86400000,
  );
  const selected = new ExportRecords();
  let readBudget = MAX_EXPORT_BYTES;
  for (const item of files) {
    signal.throwIfAborted();
    if (readBudget <= 0 || selected.full) {
      selected.truncated = true;
      break;
    }
    let tail;
    try {
      tail = await readLogTail(item.file, readBudget, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      selected.truncated = true;
      continue;
    }
    readBudget -= tail.bytesRead;
    selected.truncated ||= tail.truncated;
    selected.append(tail.text);
  }
  signal.throwIfAborted();
  return {
    format: 'praxis-diagnostics',
    version: 1,
    exportedAt: new Date().toISOString(),
    includes: ['execution-identifiers', 'status-codes', 'timings', 'counters'],
    excludes: [
      'conversation-content',
      'file-content',
      'credentials',
      'paths',
      'urls',
      'environment',
    ],
    limits: { maxBytes: MAX_EXPORT_BYTES, maxRecords: MAX_EXPORT_RECORDS },
    truncated: selected.truncated || selected.excluded > 0,
    excludedRecords: selected.excluded,
    records: selected.records.reverse(),
  };
}

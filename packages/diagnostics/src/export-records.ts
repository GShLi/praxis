import {
  diagnosticRecordSchema,
  MAX_EXPORT_BYTES,
  MAX_EXPORT_RECORDS,
  type DiagnosticRecord,
} from './schema.ts';

/** Owns the export's byte/record budget, independent of file I/O. */
export class ExportRecords {
  readonly records: DiagnosticRecord[] = [];
  truncated = false;
  excluded = 0;
  private budget = MAX_EXPORT_BYTES - 16384;
  get full() {
    return this.budget <= 0 || this.records.length >= MAX_EXPORT_RECORDS;
  }
  append(text: string) {
    const lines = text.split('\n');
    if (lines.at(-1) === '') lines.pop();
    else if (lines.length) {
      lines.pop();
      this.excluded++;
    }
    for (const line of lines.reverse()) {
      const record = this.parse(line);
      if (!record) {
        this.excluded++;
        continue;
      }
      const size = Buffer.byteLength(JSON.stringify(record)) + 1;
      if (size > this.budget || this.full) {
        this.truncated = true;
        break;
      }
      this.budget -= size;
      this.records.push(record);
    }
  }
  private parse(line: string) {
    try {
      const parsed = diagnosticRecordSchema.safeParse(JSON.parse(line));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    } // Damaged JSON is counted, never included verbatim.
  }
}

import type { DatabaseSync } from 'node:sqlite';

/** Bounded pages avoid Node 22 iterators losing their prepared statement during GC. */
export function* mcpOperationEvents(db: DatabaseSync, sessionId: string) {
  let after = 0;
  for (;;) {
    const rows = db
      .prepare(
        `SELECT seq,document FROM events WHERE session_id=? AND seq>?
      AND json_extract(document,'$.type') IN ('mcp/operation-started','mcp/dispatch','mcp/operation-finished')
      ORDER BY seq LIMIT 500`,
      )
      .all(sessionId, after);
    if (!rows.length) return;
    for (const row of rows) yield row;
    after = Number(rows.at(-1)!.seq);
  }
}

import type { Message, Event } from '@praxis/contracts';
import { assert } from '@praxis/contracts';
import { uuid } from './identity.ts';
import type { StoreAccess } from './store-access.ts';
import type { Row } from './types.ts';
export class HistoryRepository {
  constructor(private store: Pick<StoreAccess, 'transaction' | 'append' | 'db'>) {}
  interactionReceipt(
    id: string,
    type: 'question/answered' | 'approval/resolved',
    interactionId: string,
  ): Record<string, unknown> | undefined {
    const field = type === 'question/answered' ? '$.payload.questionId' : '$.payload.approvalId';
    const row = this.store.db
      .prepare(
        "SELECT document FROM events WHERE session_id=? AND json_extract(document,'$.type')=? AND json_extract(document,?)=? ORDER BY seq DESC LIMIT 1",
      )
      .get(id, type, field, interactionId) as Row | undefined;
    return row ? (JSON.parse(String(row.document)) as Event).payload : undefined;
  }
  message(id: string, message: Message) {
    return this.store.transaction(() => {
      const event = this.store.append(
        id,
        `${message.role}/message`,
        { message },
        message.role === 'user' ? 'user' : message.role === 'tool' ? 'tool' : 'model',
      );
      this.store.db
        .prepare('INSERT INTO messages VALUES(?,?,?,?)')
        .run(message.id, id, event.seq, JSON.stringify(message));
    });
  }
  messages(id: string): Message[] {
    return (
      this.store.db
        .prepare('SELECT document FROM messages WHERE session_id=? ORDER BY ordinal')
        .all(id) as Row[]
    ).map((r) => JSON.parse(String(r.document)) as Message);
  }
  timeline(id: string): Message[] {
    const rows = this.store.db
      .prepare(
        "SELECT document FROM events WHERE session_id=? AND (json_extract(document,'$.type') LIKE '%/message' OR json_extract(document,'$.type') IN ('plugin/tool-result','plugin/command-result')) ORDER BY seq",
      )
      .all(id) as Row[];
    return rows.flatMap((row) => {
      const event = JSON.parse(String(row.document)) as Event;
      if (event.type.endsWith('/message')) return [event.payload.message as Message];
      const result =
        event.type === 'plugin/tool-result'
          ? event.payload.result
          : {
              callId: event.eventId,
              toolId: `${String(event.payload.pluginId)}/${String(event.payload.name)}`,
              toolVersion: 1,
              status: 'succeeded',
              effectState: 'unknown',
              artifactIds: [event.payload.artifactId],
              truncated: event.payload.truncated,
              durationMs: 0,
              data: { preview: event.payload.preview },
            };
      return [{ id: event.eventId, role: 'tool' as const, content: JSON.stringify(result) }];
    });
  }
  artifact(id: string, kind: string, content: string): string {
    const row = this.store.db
      .prepare(
        'SELECT COALESCE(SUM(length(CAST(content AS BLOB))),0) AS size FROM artifacts WHERE session_id=?',
      )
      .get(id) as Row;
    assert(
      Number(row.size) + Buffer.byteLength(content) <= 200 * 1024 * 1024,
      'OUTPUT_LIMIT_EXCEEDED',
      '会话产物容量已满。',
    );
    const artifactId = uuid();
    this.store.db
      .prepare('INSERT INTO artifacts VALUES(?,?,?,?,?)')
      .run(artifactId, id, kind, content, new Date().toISOString());
    return artifactId;
  }
  readArtifact(id: string, artifactId: string): { kind: string; content: string } {
    const row = this.store.db
      .prepare('SELECT kind,content FROM artifacts WHERE id=? AND session_id=?')
      .get(artifactId, id) as Row | undefined;
    assert(row, 'ARTIFACT_UNAVAILABLE', '产物不存在或不属于此会话。');
    return { kind: String(row.kind), content: String(row.content) };
  }
}

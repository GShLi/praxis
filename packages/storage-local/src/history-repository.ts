import type { Message } from '@praxis/contracts';
import { assert } from '@praxis/contracts';
import { uuid } from './identity.ts';
import type { StoreAccess } from './store-access.ts';
import type { Row } from './types.ts';
export class HistoryRepository {
  constructor(private store: Pick<StoreAccess, 'transaction' | 'append' | 'db'>) {}
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
  context(id: string): {
    version: number;
    summary: Message | null;
    throughMessageId: string | null;
  } {
    const row = this.store.db
      .prepare('SELECT document FROM contexts WHERE session_id=? ORDER BY version DESC LIMIT 1')
      .get(id) as Row | undefined;
    return row
      ? JSON.parse(String(row.document))
      : { version: 0, summary: null, throughMessageId: null };
  }
  commitContext(
    id: string,
    expectedVersion: number,
    summary: Message,
    throughMessageId: string,
    sources: string[],
  ) {
    this.store.transaction(() => {
      assert(this.context(id).version === expectedVersion, 'CONTEXT_CONFLICT', '上下文已变化。');
      const value = { version: expectedVersion + 1, summary, throughMessageId, sources };
      this.store.db
        .prepare('INSERT INTO contexts VALUES(?,?,?)')
        .run(id, value.version, JSON.stringify(value));
      this.store.append(id, 'context/compaction_committed', value);
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

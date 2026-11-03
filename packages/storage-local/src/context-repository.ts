import { assert, type Message } from '@praxis/contracts';
import { contextViewSchema, type ContextCandidate, type ContextView } from './context-schema.ts';
import { validateContextReferences } from './context-references.ts';
import type { StoreAccess } from './store-access.ts';

export class ContextRepository {
  constructor(private store: Pick<StoreAccess, 'transaction' | 'append' | 'db'>) {}
  read(id: string): ContextView {
    const row = this.store.db
      .prepare('SELECT document FROM contexts WHERE session_id=? ORDER BY version DESC LIMIT 1')
      .get(id);
    const value: unknown = row
      ? JSON.parse(String(row.document))
      : { version: 0, summary: null, throughMessageId: null };
    const parsed = contextViewSchema.safeParse(value);
    assert(parsed.success, 'INVALID_CONTEXT', '上下文版本记录无效。');
    return parsed.data;
  }
  publish(
    id: string,
    expectedVersion: number,
    candidate: ContextCandidate,
    reason: 'summary' | 'tool-output',
  ) {
    return this.store.transaction(() => {
      assert(this.read(id).version === expectedVersion, 'CONTEXT_CONFLICT', '上下文已变化。');
      const value = contextViewSchema.parse({
        ...candidate,
        schemaVersion: 2,
        version: expectedVersion + 1,
      });
      assert(
        (value.summary && value.throughMessageId) || value.toolOutputs?.length,
        'INVALID_CONTEXT',
        '上下文版本没有摘要或工具正文投影。',
      );
      validateContextReferences(this.store.db, id, value);
      this.store.db
        .prepare('INSERT INTO contexts VALUES(?,?,?)')
        .run(id, value.version, JSON.stringify(value));
      this.store.append(id, 'context/compaction_committed', { ...value, reason });
      return value;
    });
  }
  commit(
    id: string,
    expectedVersion: number,
    summary: Message,
    throughMessageId: string,
    sources: string[],
  ) {
    return this.publish(id, expectedVersion, { summary, throughMessageId, sources }, 'summary');
  }
}

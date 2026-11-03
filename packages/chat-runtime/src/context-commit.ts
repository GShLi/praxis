import { assert, type Message } from '@praxis/contracts';
import type { ChatContextServices } from './context-types.ts';
import type { Running } from './types.ts';

/** Lock the chat, compare the source view, and publish only after PostgreSQL commits. */
export async function commitChatContext(
  services: ChatContextServices,
  run: Running,
  expectedVersion: number,
  source: Message[],
  summary: Message,
) {
  const signal = run.controller.signal;
  signal.throwIfAborted();
  const through = source.at(-1)?.id;
  assert(through, 'COMPACTION_NO_PROGRESS', '没有可压缩的新历史。');
  const result = await services.database.transaction(async (sql) => {
    signal.throwIfAborted();
    const chat = await services.repository.owned(run.owner, run.chatId, sql, true);
    assert(chat.active_generation === run.id, 'STALE_GENERATION', '生成任务已经失效。');
    const row = (
      await sql.query<{ version: number; active: number }>(
        'SELECT COALESCE(MAX(version),0)+1 AS version, COALESCE(MAX(version) FILTER (WHERE valid),0) AS active FROM chat_contexts WHERE session_id=$1',
        [run.chatId],
      )
    ).rows[0];
    assert(row && row.active === expectedVersion, 'CONTEXT_CONFLICT', '上下文版本已变化。');
    signal.throwIfAborted();
    const sourceIds = source.map((message) => message.id);
    await sql.query(
      'INSERT INTO chat_contexts(session_id,version,summary,source_ids,through_input) VALUES($1,$2,$3,$4,$5)',
      [run.chatId, row.version, JSON.stringify(summary), JSON.stringify(sourceIds), through],
    );
    const event = await services.repository.event(sql, run.chatId, 'context/compaction_committed', {
      version: row.version,
      sourceVersion: expectedVersion,
      generationId: run.id,
      summary,
      sourceIds,
    });
    signal.throwIfAborted();
    return { version: row.version, event };
  }, signal);
  services.emit('event', result.event);
  return result.version;
}

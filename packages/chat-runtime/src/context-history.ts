import type { Message } from '@praxis/contracts';
import type { ChatContextServices } from './context-types.ts';
import type { Running } from './types.ts';

export async function readChatHistory(
  services: ChatContextServices,
  run: Running,
  currentInput: string,
): Promise<Message[]> {
  const rows = (
    await services.database.query<{
      id: string;
      content: string;
      selected_generation: string | null;
      answer: string | null;
    }>(
      'SELECT i.id,i.content,i.selected_generation,g.content AS answer FROM chat_inputs i LEFT JOIN chat_generations g ON g.id=i.selected_generation WHERE i.session_id=$1 ORDER BY i.ordinal',
      [run.chatId],
    )
  ).rows;
  const all: Message[] = rows.flatMap((row) => [
    { id: row.id, role: 'user' as const, content: row.content },
    ...(row.answer !== null && row.id !== currentInput
      ? [{ id: row.selected_generation!, role: 'assistant' as const, content: row.answer }]
      : []),
  ]);
  return all;
}

export async function commitChatContext(
  services: ChatContextServices,
  run: Running,
  source: Message[],
  summary: Message,
) {
  await services.database.transaction(async (sql) => {
    await services.repository.owned(run.owner, run.chatId, sql, true);
    const row = (
      await sql.query<{ version: number }>(
        'SELECT COALESCE(MAX(version),0)+1 AS version FROM chat_contexts WHERE session_id=$1',
        [run.chatId],
      )
    ).rows[0]!;
    await sql.query(
      'INSERT INTO chat_contexts(session_id,version,summary,source_ids,through_input) VALUES($1,$2,$3,$4,$5)',
      [
        run.chatId,
        row.version,
        JSON.stringify(summary),
        JSON.stringify(source.map((m) => m.id)),
        source.at(-1)!.id,
      ],
    );
    await services.repository.event(sql, run.chatId, 'context/compaction_committed', {
      version: row.version,
      summary,
      sourceIds: source.map((m) => m.id),
    });
  });
}

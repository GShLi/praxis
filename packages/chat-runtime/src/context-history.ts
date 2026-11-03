import { assert, type Message } from '@praxis/contracts';
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

export async function readChatContext(
  services: ChatContextServices,
  run: Running,
  currentInput: string,
) {
  const all = await readChatHistory(services, run, currentInput);
  const previous = (
    await services.database.query<{ version: number; summary: Message; through_input: string }>(
      'SELECT version,summary,through_input FROM chat_contexts WHERE session_id=$1 AND valid=true ORDER BY version DESC LIMIT 1',
      [run.chatId],
    )
  ).rows[0];
  if (!previous) return { version: 0, messages: all, summaryId: undefined };
  const through = all.findIndex((message) => message.id === previous.through_input);
  assert(through >= 0, 'INVALID_CONTEXT', '上下文来源消息不存在。');
  return {
    version: previous.version,
    messages: [previous.summary, ...all.slice(through + 1)],
    summaryId: previous.summary.id,
  };
}

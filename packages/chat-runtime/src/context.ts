import { budget, estimate } from '@praxis/context';
import { assert, type Message, type ModelConfig } from '@praxis/contracts';
import type { ChatContextServices } from './context-types.ts';
import { readChatHistory, commitChatContext } from './context-history.ts';
import { summarizeChat } from './context-summary.ts';
import type { Running } from './types.ts';

export async function buildChatContext(
  services: ChatContextServices,
  run: Running,
  config: ModelConfig,
  currentInput: string,
  personal: Message[] = [],
): Promise<Message[]> {
  const all = await readChatHistory(services, run, currentInput);
  const fixed: Message[] = [
    {
      id: 'chat-system-v1',
      role: 'system',
      content:
        '你是知行 Praxis ChatBot。只回答和提供内容，不操作文件、不执行命令，不声称已实际执行工具。',
    },
    ...personal,
  ];
  const limits = budget(config);
  assert(estimate(fixed) < limits.trigger, 'CONTEXT_FIXED_TOO_LARGE', '固定指令超过输入预算。');
  const previous = (
    await services.database.query<{ version: number; summary: Message; through_input: string }>(
      'SELECT version,summary,through_input FROM chat_contexts WHERE session_id=$1 AND valid=true ORDER BY version DESC LIMIT 1',
      [run.chatId],
    )
  ).rows[0];
  let messages = previous
    ? [previous.summary, ...all.slice(all.findIndex((m) => m.id === previous.through_input) + 1)]
    : all;
  if (estimate([fixed, messages]) >= limits.trigger) {
    let start = messages.findLastIndex((m) => m.role === 'user');
    let size = estimate(messages.slice(start));
    while (start > 0 && size < limits.retain) size += estimate(messages[--start]);
    assert(start > 0, 'CONTEXT_TOO_LARGE', '最新输入超过上下文预算。');
    const source = messages.slice(0, start);
    assert(
      estimate(source) < limits.available,
      'CONTEXT_TOO_LARGE',
      '历史需要分块压缩，当前请求超过摘要窗口。',
    );
    const summary = await summarizeChat(services, run, config, source, limits.summary);
    await commitChatContext(services, run, source, summary);
    messages = [summary, ...messages.slice(start)];
  }
  assert(estimate([fixed, messages]) < limits.available, 'CONTEXT_TOO_LARGE', '模型输入超过窗口。');
  return [...fixed, ...messages];
}

import { budget, estimate, compactionSource } from '@praxis/context';
import { assert, type Message, type ModelConfig } from '@praxis/contracts';
import type { ChatContextServices } from './context-types.ts';
import { readChatContext } from './context-history.ts';
import { commitChatContext } from './context-commit.ts';
import { chatSummaryJob, summarizeChat } from './context-summary.ts';
import type { Running } from './types.ts';

export async function buildChatContext(
  services: ChatContextServices,
  run: Running,
  config: ModelConfig,
  currentInput: string,
  personal: Message[] = [],
  force = false,
) {
  let { messages, version, summaryId } = await readChatContext(services, run, currentInput);
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
  const job = chatSummaryJob(services, run, config);
  for (let contraction = 0; contraction < 2; contraction++) {
    if ((!force || contraction > 0) && estimate([fixed, messages]) < limits.trigger) break;
    const { groups, tail } = compactionSource(messages, force ? 0 : limits.retain);
    const source = groups.flat();
    assert(
      source.some((message) => message.id !== summaryId),
      'COMPACTION_NO_PROGRESS',
      '没有可压缩的新历史。',
    );
    const summary = await summarizeChat(job, services, run, groups, version);
    assert(
      estimate([summary, ...tail]) < estimate(messages),
      'COMPACTION_NO_PROGRESS',
      '候选摘要未缩小输入，保留原视图。',
    );
    version = await commitChatContext(services, run, version, source, summary);
    summaryId = summary.id;
    messages = [summary, ...tail];
  }
  assert(estimate([fixed, messages]) < limits.trigger, 'CONTEXT_TOO_LARGE', '压缩后仍超过预算。');
  return { messages: [...fixed, ...messages], version };
}

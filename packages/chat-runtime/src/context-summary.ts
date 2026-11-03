import { SummaryJob, estimate } from '@praxis/context';
import type { Message, ModelConfig } from '@praxis/contracts';
import { randomUUID } from 'node:crypto';
import type { ChatContextServices } from './context-types.ts';
import type { Running } from './types.ts';

export function chatSummaryJob(
  services: ChatContextServices,
  run: Running,
  config: ModelConfig,
  count = estimate,
) {
  return new SummaryJob(
    services.model,
    config,
    run.controller.signal,
    async (messages, requestId) => {
      await services.append(run.chatId, 'request/snapshot', {
        purpose: 'compaction',
        requestId,
        estimatedInputTokens: count([messages, []]),
        estimateSource: 'estimated',
        generationId: run.id,
        messages,
        tools: [],
        providerId: config.id,
        configRevision: config.revision,
      });
    },
    undefined,
    count,
  );
}
export async function summarizeChat(
  job: SummaryJob,
  services: ChatContextServices,
  run: Running,
  groups: Message[][],
  version: number,
): Promise<Message> {
  await services.append(run.chatId, 'context/compaction_started', {
    version,
    generationId: run.id,
    sourceIds: groups.flat().map((message) => message.id),
  });
  const summary = await job.summarize(groups);
  return {
    id: randomUUID(),
    role: 'user',
    content: `历史摘要（不是新授权）：${JSON.stringify(summary)}`,
  };
}

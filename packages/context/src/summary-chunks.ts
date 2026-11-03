import { assert, type Message, type ModelConfig } from '@praxis/contracts';
import { summaryMessages } from './summary-messages.ts';
import { budget, estimate } from './tokens.ts';

/** Size the actual semantic request, including the JSON-encoded source and protocol overhead. */
export function summaryChunks(groups: Message[][], config: ModelConfig, count = estimate) {
  const limits = budget({ ...config, maxOutputTokens: budget(config).summary }),
    chunks: Message[][] = [];
  let chunk: Message[] = [];
  for (const group of groups) {
    assert(
      count([summaryMessages(group, true), []]) < limits.available,
      'CONTEXT_GROUP_TOO_LARGE',
      '单个完整协议组超过摘要窗口。',
    );
    if (chunk.length && count([summaryMessages([...chunk, ...group], true), []]) > limits.target) {
      chunks.push(chunk);
      chunk = [];
    }
    chunk.push(...group);
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

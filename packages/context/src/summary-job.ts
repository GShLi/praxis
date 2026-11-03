import { assert, PraxisError, type Message, type ModelConfig } from '@praxis/contracts';
import type { ModelClient } from '@praxis/model-core';
import { randomUUID } from 'node:crypto';
import { summaryChunks } from './summary-chunks.ts';
import { summaryMessages } from './summary-messages.ts';
import { summarySchema } from './summary.ts';
import { budget, estimate } from './tokens.ts';

/** One compaction trigger shares this bounded job across chunks, merging and at most two contractions. */
export class SummaryJob {
  private count = 0;
  constructor(
    private model: ModelClient,
    private config: ModelConfig,
    private signal: AbortSignal,
    private snapshot: (messages: Message[], requestId: string) => void | Promise<void>,
    private consumeAttempt: () => void = () => {},
    private estimateTokens = estimate,
  ) {}
  async summarize(groups: Message[][]) {
    this.signal.throwIfAborted();
    const chunks = summaryChunks(groups, this.config, this.estimateTokens);
    assert(chunks.length > 0, 'COMPACTION_NO_PROGRESS', '没有可压缩的历史。');
    const minimum = chunks.length + (chunks.length > 1 ? 1 : 0);
    assert(this.count + minimum <= 8, 'COMPACTION_BUDGET', '历史需要过多摘要步骤，请缩小任务。');
    const partials = [];
    for (const chunk of chunks) partials.push(await this.generate(chunk));
    const first = partials[0];
    assert(first, 'INVALID_SUMMARY', '摘要为空。');
    return partials.length === 1 ? first : this.generate(partials);
  }
  private async generate(source: unknown) {
    const summaryLimit = budget(this.config).summary;
    const config = { ...this.config, maxOutputTokens: summaryLimit };
    const limits = budget(config);
    for (let correction = 0; correction < 2; correction++) {
      this.signal.throwIfAborted();
      const messages = summaryMessages(source, correction > 0);
      assert(
        this.estimateTokens([messages, []]) < limits.available,
        'CONTEXT_GROUP_TOO_LARGE',
        '摘要请求超过模型窗口。',
      );
      this.charge();
      const requestId = randomUUID();
      await this.snapshot(messages, requestId);
      this.signal.throwIfAborted();
      const answer = await this.model.complete({
        requestId,
        messages,
        tools: [],
        config,
        purpose: 'compaction',
        signal: this.signal,
        onDelta: () => {},
        beforeRetry: () => this.charge(),
      });
      this.signal.throwIfAborted();
      assert(!answer.message.toolCalls?.length, 'UNEXPECTED_TOOL_CALL', '摘要模型不能调用工具。');
      try {
        const summary = summarySchema.parse(JSON.parse(answer.message.content));
        assert(this.estimateTokens(summary) <= summaryLimit, 'SUMMARY_TOO_LARGE', '摘要超过预算。');
        return summary;
      } catch {
        if (correction)
          throw new PraxisError('INVALID_SUMMARY', '摘要结构或大小验证失败，原上下文保持不变。');
      }
    }
    throw new PraxisError('INVALID_SUMMARY', '摘要失败。');
  }
  private charge() {
    this.signal.throwIfAborted();
    assert(++this.count <= 8, 'COMPACTION_BUDGET', '摘要尝试次数达到上限。');
    this.consumeAttempt();
  }
}

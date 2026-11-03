import type { Message, ModelConfig, ToolDefinition } from '@praxis/contracts';
import { assert } from '@praxis/contracts';
import type { ModelClient } from '@praxis/model-core';
import { SessionStore } from '@praxis/storage-local';
import { compactHistory } from './compact-history.ts';
import { pruneToolOutputs } from './prune-tool-outputs.ts';
import { SummaryJob } from './summary-job.ts';
import { budget, estimate } from './tokens.ts';
import { readContextHistory } from './context-history.ts';

export class ContextBuilder {
  constructor(
    private store: SessionStore,
    private model: ModelClient,
    private count = estimate,
  ) {}
  async build(
    id: string,
    fixed: Message[],
    tools: ToolDefinition[],
    config: ModelConfig,
    signal: AbortSignal,
    attempt: () => void,
    force = false,
  ): Promise<Message[]> {
    const limits = budget(config);
    assert(
      this.count([fixed, tools]) < limits.trigger,
      'CONTEXT_FIXED_TOO_LARGE',
      '固定提示词和工具定义超过输入预算。',
    );
    const initial = readContextHistory(this.store, id);
    if (
      (force || this.count([[...fixed, ...initial.history], tools]) >= limits.trigger) &&
      pruneToolOutputs(this.store, id, signal)
    ) {
      const pruned = readContextHistory(this.store, id);
      if (this.count([[...fixed, ...pruned.history], tools]) < limits.trigger)
        return [...fixed, ...pruned.history];
    }
    const summaryJob = this.summaryJob(id, config, signal, attempt);
    for (let shrink = 0; shrink < 2; shrink++) {
      const { view, history } = readContextHistory(this.store, id);
      if ((!force || shrink > 0) && this.count([[...fixed, ...history], tools]) < limits.trigger)
        return [...fixed, ...history];
      await compactHistory(
        this.store,
        id,
        view,
        history,
        summaryJob,
        force ? 0 : limits.retain,
        this.count,
        signal,
      );
    }
    const { history } = readContextHistory(this.store, id);
    const result = [...fixed, ...history];
    assert(this.count([result, tools]) < limits.trigger, 'CONTEXT_TOO_LARGE', '压缩后仍超过预算。');
    return result;
  }
  private summaryJob(id: string, config: ModelConfig, signal: AbortSignal, attempt: () => void) {
    return new SummaryJob(
      this.model,
      config,
      signal,
      (messages, requestId) => {
        this.store.append(id, 'request/snapshot', {
          requestId,
          purpose: 'compaction',
          messages,
          tools: [],
          estimatedInputTokens: this.count([messages, []]),
          estimateSource: 'estimated',
          providerId: config.id,
          configRevision: config.revision,
        });
      },
      attempt,
      this.count,
    );
  }
}

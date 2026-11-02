import { assert, PraxisError, type ToolCall } from '@praxis/contracts';
import { parseCompletionChunk } from './completion-schema.ts';
import type { Completion } from './types.ts';
export class CompletionAccumulator {
  private content = '';
  private reasoning = '';
  private finishReason = '';
  ended = false;
  private calls = new Map<number, ToolCall>();
  private usage = { input: 0, output: 0 };
  constructor(private onDelta: (text: string) => void) {}
  consume(line: string) {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data) return;
    if (data === '[DONE]') {
      this.ended = true;
      return;
    }
    const chunk = parseCompletionChunk(data);
    assert(!chunk.error, 'MODEL_STREAM_ERROR', '模型流报告错误。');
    if (chunk.usage)
      this.usage = {
        input: chunk.usage.prompt_tokens ?? 0,
        output: chunk.usage.completion_tokens ?? 0,
      };
    const choice = chunk.choices?.find((c) => c.index === 0 || c.index === undefined);
    if (!choice) return;
    if (typeof choice.delta?.content === 'string') {
      this.content += choice.delta.content;
      this.onDelta(choice.delta.content);
    }
    if (typeof choice.delta?.reasoning_content === 'string')
      this.reasoning += choice.delta.reasoning_content;
    for (const delta of choice.delta?.tool_calls ?? []) {
      assert(
        Number.isInteger(delta.index) && delta.index >= 0 && delta.index < 64,
        'MODEL_PROTOCOL_ERROR',
        '无效工具索引。',
      );
      const call = this.calls.get(delta.index) ?? { id: '', name: '', arguments: '' };
      call.id += delta.id ?? '';
      call.name += delta.function?.name ?? '';
      call.arguments += delta.function?.arguments ?? '';
      this.calls.set(delta.index, call);
    }
    if (choice.finish_reason) this.finishReason = choice.finish_reason;
  }
  finish(): Completion {
    assert(
      this.ended && ['stop', 'tool_calls'].includes(this.finishReason),
      'MODEL_INCOMPLETE',
      '模型输出未完整结束，未执行其中工具。',
    );
    const toolCalls = [...this.calls.entries()].sort(([a], [b]) => a - b).map(([, c]) => c);
    assert(
      !toolCalls.length || this.finishReason === 'tool_calls',
      'MODEL_PROTOCOL_ERROR',
      '工具批次结束状态不一致。',
    );
    assert(
      new Set(toolCalls.map((c) => c.id)).size === toolCalls.length,
      'MODEL_PROTOCOL_ERROR',
      '工具调用 ID 重复。',
    );
    for (const call of toolCalls) {
      assert(
        call.id && /^[a-zA-Z0-9_-]{1,64}$/.test(call.name),
        'MODEL_PROTOCOL_ERROR',
        '工具标识无效。',
      );
      try {
        JSON.parse(call.arguments);
      } catch {
        throw new PraxisError('MODEL_PROTOCOL_ERROR', '工具参数 JSON 不完整。');
      }
    }
    return {
      message: {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: this.content,
        ...(toolCalls.length ? { toolCalls } : {}),
        ...(this.reasoning ? { reasoning: this.reasoning } : {}),
      },
      finishReason: this.finishReason,
      usage: this.usage,
    };
  }
}

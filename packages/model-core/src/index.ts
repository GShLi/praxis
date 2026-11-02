import { setTimeout as delay } from 'node:timers/promises';
import { assert, PraxisError } from '../../contracts/src/index.ts';
import type { Message, ModelConfig, ToolCall, ToolDefinition } from '../../contracts/src/index.ts';

export interface Completion {
  message: Message;
  usage: { input: number; output: number };
  finishReason: string;
}
export interface ModelRequest {
  messages: Message[];
  tools: ToolDefinition[];
  config: ModelConfig;
  purpose: 'agent_step' | 'chat_generation' | 'compaction';
  signal: AbortSignal;
  onDelta: (text: string) => void;
}
export interface ModelClient {
  complete(request: ModelRequest): Promise<Completion>;
}

/** An OpenAI-compatible DeepSeek adapter; no Agent framework or execution authority. */
export class DeepSeekClient implements ModelClient {
  constructor(private fetcher: typeof fetch = fetch) {}
  async complete(request: ModelRequest): Promise<Completion> {
    const { config, signal } = request;
    const endpoint = new URL(config.baseUrl);
    assert(
      endpoint.protocol === 'https:' &&
        !endpoint.username &&
        !endpoint.password &&
        !endpoint.hash &&
        !endpoint.search,
      'INVALID_PROVIDER_URL',
      '模型地址必须是无凭据的 HTTPS URL。',
    );
    endpoint.pathname = endpoint.pathname.replace(/\/$/, '') + '/chat/completions';
    const messages = request.messages.map((message) => ({
      role: message.role,
      content: message.content || (message.toolCalls?.length ? null : ''),
      ...(message.toolCalls
        ? {
            tool_calls: message.toolCalls.map((t) => ({
              id: t.id,
              type: 'function',
              function: { name: t.name, arguments: t.arguments },
            })),
          }
        : {}),
      ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
      ...(message.reasoning ? { reasoning_content: message.reasoning } : {}),
    }));
    const body = JSON.stringify({
      model: config.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: config.maxOutputTokens,
      ...(request.tools.length
        ? {
            tools: request.tools.map((tool) => ({
              type: 'function',
              function: {
                name: tool.modelName,
                description: tool.description,
                parameters: tool.parameters,
              },
            })),
          }
        : {}),
    });
    let response: Response | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      signal.throwIfAborted();
      try {
        response = await this.fetcher(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
          body,
          signal,
          redirect: 'error',
        });
      } catch (error) {
        if (signal.aborted) throw error;
        throw new PraxisError(
          'MODEL_CONNECTION_FAILED',
          '模型连接失败，请检查网络、代理及厂商地址。',
        );
      }
      if (response.ok) break;
      const status = response.status;
      const retryAfter = Math.min(
        10_000,
        Math.max(0, Number(response.headers.get('retry-after') ?? 0) * 1000),
      );
      // Error bodies may contain secrets echoed by gateways; never persist or display them.
      await response.body?.cancel();
      if ([408, 429, 500, 502, 503, 504].includes(status) && attempt < 2) {
        await delay(Math.max(retryAfter, 500 * 2 ** attempt), undefined, { signal });
        continue;
      }
      throw new PraxisError(
        status === 401 || status === 403 ? 'MODEL_AUTH_FAILED' : 'MODEL_HTTP_ERROR',
        `模型请求失败（HTTP ${status}）。`,
        status === 429 || status >= 500,
      );
    }
    assert(response?.ok && response.body, 'MODEL_EMPTY_RESPONSE', '模型未返回响应流。');
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let buffer = '';
    let content = '';
    let reasoning = '';
    let finishReason = '';
    let ended = false;
    let total = 0;
    const calls = new Map<number, ToolCall>();
    let usage = { input: 0, output: 0 };
    const consume = (line: string) => {
      if (!line.startsWith('data:')) return;
      const data = line.slice(5).trim();
      if (!data) return;
      if (data === '[DONE]') {
        ended = true;
        return;
      }
      let chunk: {
        error?: unknown;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        choices?: Array<{
          index?: number;
          delta?: {
            content?: string;
            reasoning_content?: string;
            tool_calls?: Array<{
              index: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
          finish_reason?: string | null;
        }>;
      };
      try {
        chunk = JSON.parse(data) as typeof chunk;
      } catch {
        throw new PraxisError('MODEL_PROTOCOL_ERROR', '模型流包含无效 JSON。');
      }
      assert(!chunk.error, 'MODEL_STREAM_ERROR', '模型流报告错误。');
      if (chunk.usage)
        usage = {
          input: chunk.usage.prompt_tokens ?? 0,
          output: chunk.usage.completion_tokens ?? 0,
        };
      const choice = chunk.choices?.find((c) => c.index === 0 || c.index === undefined);
      if (!choice) return;
      if (typeof choice.delta?.content === 'string') {
        content += choice.delta.content;
        request.onDelta(choice.delta.content);
      }
      if (typeof choice.delta?.reasoning_content === 'string')
        reasoning += choice.delta.reasoning_content;
      for (const delta of choice.delta?.tool_calls ?? []) {
        assert(
          Number.isInteger(delta.index) && delta.index >= 0 && delta.index < 64,
          'MODEL_PROTOCOL_ERROR',
          '无效工具索引。',
        );
        const call = calls.get(delta.index) ?? { id: '', name: '', arguments: '' };
        call.id += delta.id ?? '';
        call.name += delta.function?.name ?? '';
        call.arguments += delta.function?.arguments ?? '';
        calls.set(delta.index, call);
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    };
    try {
      for (;;) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) break;
        total += chunk.value.length;
        assert(total <= 8 * 1024 * 1024, 'MODEL_OUTPUT_LIMIT', '模型输出超过上限。');
        buffer += decoder.decode(chunk.value, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          consume(buffer.slice(0, newline).replace(/\r$/, ''));
          buffer = buffer.slice(newline + 1);
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) consume(buffer);
      assert(
        ended && ['stop', 'tool_calls'].includes(finishReason),
        'MODEL_INCOMPLETE',
        '模型输出未完整结束，未执行其中工具。',
      );
      const toolCalls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, c]) => c);
      assert(
        !toolCalls.length || finishReason === 'tool_calls',
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
          content,
          ...(toolCalls.length ? { toolCalls } : {}),
          ...(reasoning ? { reasoning } : {}),
        },
        finishReason,
        usage,
      };
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}

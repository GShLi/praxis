import {
  isInputRequiredResult,
  type InputRequiredResult,
  type ElicitResult,
} from '@modelcontextprotocol/client';
import { assert } from '@praxis/contracts';
import { fingerprint } from '@praxis/config';
import type { Ask } from '@praxis/tools';
import { z } from 'zod';
import { answerForm, prepareForm } from './form.ts';
export interface McpInteractionOptions {
  ask?: Ask;
  server: string;
  sensitiveValues: readonly string[];
  record(type: string, data: Record<string, unknown>): void;
  beforeContinue(responses: Record<string, ElicitResult>): Promise<void>;
}
export interface Continuation {
  requestState?: string;
  inputResponses?: Record<string, ElicitResult>;
}
const inputRequest = z.object({ method: z.literal('elicitation/create'), params: z.unknown() });
/** A single business call owns state and continuation budget. Opaque state never reaches record(). */
export class McpInteraction {
  private active = false;
  private round = 0;
  private waiting = false;
  private legacyPending = false;
  private receiving = false;
  private declined = false;
  private failure: unknown;
  private lifetime: AbortController | undefined;
  constructor(
    private options: McpInteractionOptions,
    private signal: AbortSignal,
  ) {}
  get interactive() {
    return Boolean(this.options.ask);
  }
  async run(send: (continuation: Continuation) => Promise<unknown>) {
    assert(!this.active, 'MCP_BUSY', '连接已有活动业务调用。');
    this.active = true;
    this.round = 0;
    this.declined = false;
    this.failure = undefined;
    this.lifetime = new AbortController();
    try {
      let result = await this.receive(send, {});
      while (isInputRequiredResult(result)) {
        assert(
          !this.declined,
          'MCP_INPUT_DECLINED',
          '用户已拒绝表单，服务器仍要求输入；未继续执行。',
        );
        assert(++this.round <= 8, 'MCP_INPUT_LIMIT', '交互续交超过 8 次。');
        const forms = this.prepareRound(result);
        const responses: Record<string, ElicitResult> = Object.create(null);
        for (const { id, form } of forms) responses[id] = await this.answer(id, form);
        await this.options.beforeContinue(responses);
        this.signal.throwIfAborted();
        this.options.record('mcp/continuation', {
          round: this.round,
          inputIds: forms.map((f) => f.id),
          responsesHash: fingerprint(responses),
        });
        this.declined = Object.values(responses).some((r) => r.action !== 'accept');
        result = await this.receive(send, {
          ...(result.requestState !== undefined ? { requestState: result.requestState } : {}),
          ...(forms.length ? { inputResponses: responses } : {}),
        });
      }
      return result;
    } finally {
      this.active = false;
      this.lifetime.abort();
    }
  }
  private prepareRound(result: InputRequiredResult) {
    const requests = Object.entries(result.inputRequests ?? {});
    assert(
      requests.length <= 12 &&
        (!result.requestState || Buffer.byteLength(result.requestState) <= 65536),
      'MCP_INPUT_LIMIT',
      '交互请求或状态超限。',
    );
    const forms = requests.map(([id, raw]) => {
      assert(id.length <= 256, 'MCP_INPUT_LIMIT', '输入 ID 过长。');
      const request = inputRequest.safeParse(raw);
      assert(
        request.success,
        'MCP_CAPABILITY_UNSUPPORTED',
        '不提供 sampling、roots 或其他服务器请求。',
      );
      return {
        id,
        form: prepareForm(
          request.data.params,
          { server: this.options.server, inputId: id },
          this.options.sensitiveValues,
        ),
      };
    });
    assert(
      forms.reduce((sum, f) => sum + f.form.fieldCount, 0) <= 12,
      'MCP_INPUT_LIMIT',
      '每轮最多 12 个字段。',
    );
    assert(
      !forms.length || this.options.ask,
      'MCP_CAPABILITY_UNSUPPORTED',
      '当前客户端没有人工表单通道。',
    );
    return forms;
  }
  private async receive(
    send: (continuation: Continuation) => Promise<unknown>,
    continuation: Continuation,
  ) {
    this.signal.throwIfAborted();
    this.receiving = true;
    try {
      const result = await send(continuation);
      if (this.failure) throw this.failure;
      assert(!this.legacyPending, 'MCP_INPUT_UNEXPECTED', '服务器在人工交互结束前提前完成调用。');
      return result;
    } finally {
      this.receiving = false;
    }
  }
  async legacy(params: unknown, inputId: string): Promise<ElicitResult> {
    try {
      assert(
        this.active &&
          this.receiving &&
          !this.failure &&
          !this.legacyPending &&
          !this.waiting &&
          this.options.ask,
        'MCP_INPUT_UNEXPECTED',
        '没有可关联的活动业务调用，或已有表单等待回答。',
      );
      assert(!this.declined, 'MCP_INPUT_DECLINED', '用户已拒绝表单。');
      this.legacyPending = true;
      assert(++this.round <= 8, 'MCP_INPUT_LIMIT', '交互请求超过 8 次。');
      const result = await this.answer(
        inputId,
        prepareForm(params, { server: this.options.server, inputId }, this.options.sensitiveValues),
      );
      assert(this.active && !this.failure, 'MCP_INPUT_UNEXPECTED', '原操作已结束。');
      this.declined = result.action !== 'accept';
      await this.options.beforeContinue({ [inputId]: result });
      this.signal.throwIfAborted();
      return result;
    } catch (error) {
      this.failure = error;
      throw error;
    } finally {
      this.legacyPending = false;
    }
  }
  private async answer(id: string, form: ReturnType<typeof prepareForm>) {
    assert(this.options.ask && !this.waiting, 'MCP_INPUT_UNEXPECTED', '没有可用的表单回答通道。');
    this.waiting = true;
    try {
      this.options.record('mcp/input-request', {
        round: this.round,
        inputId: id,
        fieldsHash: fingerprint(form.questions),
      });
      const result = await answerForm(
        form,
        this.options.ask,
        AbortSignal.any([this.signal, ...(this.lifetime ? [this.lifetime.signal] : [])]),
      );
      this.options.record('mcp/input-response', {
        round: this.round,
        inputId: id,
        action: result.action,
      });
      return result;
    } finally {
      this.waiting = false;
    }
  }
}

import { PraxisError } from '@praxis/contracts';
import type { Completion } from './types.ts';

/** Owns a bounded, not-yet-public suffix; keep a possible credential prefix across deltas. */
export class ModelOutputGuard {
  private pending = '';
  private bytes = 0;
  failure: PraxisError | undefined;
  constructor(
    private secret: string,
    private emit: (text: string) => void,
  ) {}
  push(text: string) {
    if (this.failure) throw this.failure;
    if (typeof text !== 'string') this.fail('MODEL_PROTOCOL_ERROR', '模型增量必须是文本。');
    this.bytes += Buffer.byteLength(text);
    if (this.bytes > 2 * 1024 * 1024) this.fail('MODEL_RESPONSE_LIMIT', '模型输出超过限制。');
    const combined = this.pending + text;
    if (this.secret && combined.includes(this.secret)) this.exposure();
    let end = Math.max(0, combined.length - Math.max(0, this.secret.length - 1));
    if (end && /[\uD800-\uDBFF]/.test(combined[end - 1]!)) end--;
    this.pending = combined.slice(end);
    if (end) this.emit(combined.slice(0, end));
  }
  validate(response: Completion) {
    const encoded = JSON.stringify(response);
    if (Buffer.byteLength(encoded) > 2 * 1024 * 1024)
      this.fail('MODEL_RESPONSE_LIMIT', '模型输出超过限制。');
    this.check(encoded);
    for (const call of response.message.toolCalls ?? []) {
      let parameters: unknown;
      try {
        parameters = JSON.parse(call.arguments);
      } catch {
        this.fail('MODEL_PROTOCOL_ERROR', '模型工具参数不是有效 JSON。');
      }
      this.check(JSON.stringify(parameters));
    }
  }
  private check(encoded: string) {
    if (this.secret && encoded.includes(JSON.stringify(this.secret).slice(1, -1))) this.exposure();
  }
  finish() {
    if (this.failure) throw this.failure;
    if (this.pending) this.emit(this.pending);
    this.pending = '';
  }
  private exposure(): never {
    return this.fail('MODEL_SECRET_EXPOSURE', '模型输出包含受保护凭据，已拒绝显示。');
  }
  private fail(code: string, message: string): never {
    this.pending = '';
    this.failure = new PraxisError(code, message);
    throw this.failure;
  }
}

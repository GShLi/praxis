import { PraxisError } from '@praxis/contracts';

/** Keep a possible credential prefix until the next delta, including across UTF-16 boundaries. */
export class ProviderStream {
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
    if (this.secret && combined.includes(this.secret))
      this.fail('MODEL_SECRET_EXPOSURE', '模型输出包含受保护凭据，已拒绝显示。');
    let end = Math.max(0, combined.length - Math.max(0, this.secret.length - 1));
    if (end && /[\uD800-\uDBFF]/.test(combined[end - 1]!)) end--;
    this.pending = combined.slice(end);
    if (end) this.emit(combined.slice(0, end));
  }
  finish() {
    if (this.failure) throw this.failure;
    if (this.pending) this.emit(this.pending);
    this.pending = '';
  }
  private fail(code: string, message: string): never {
    this.pending = '';
    this.failure = new PraxisError(code, message);
    throw this.failure;
  }
}

import { z } from 'zod';

export class PraxisError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'PraxisError';
  }
}

export function assert(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new PraxisError(code, message);
}

export function safeError(error: unknown): {
  code: string;
  safeMessage: string;
  retryable: boolean;
} {
  if (error instanceof PraxisError)
    return { code: error.code, safeMessage: error.message, retryable: error.retryable };
  if (error instanceof z.ZodError)
    return { code: 'INVALID_ARGUMENT', safeMessage: '请求参数不符合协议。', retryable: false };
  if (error instanceof Error && error.name === 'AbortError')
    return { code: 'CANCELLED', safeMessage: '操作已取消。', retryable: false };
  return { code: 'INTERNAL_ERROR', safeMessage: '操作失败，请检查脱敏诊断。', retryable: false };
}

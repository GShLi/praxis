import { PraxisError, safeError } from '@praxis/contracts';

type DesktopReply<T> = { ok: true; value: T } | { ok: false; error: ReturnType<typeof safeError> };

/** Carry only the safe error contract across Electron IPC; thrown Errors gain transport prefixes. */
export async function desktopReply<T>(operation: () => T | Promise<T>): Promise<DesktopReply<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    return { ok: false, error: safeError(error) };
  }
}

export function readDesktopReply<T>(reply: unknown): T {
  if (reply && typeof reply === 'object' && 'ok' in reply) {
    if (reply.ok === true && 'value' in reply) return reply.value as T;
    if (reply.ok === false && 'error' in reply) {
      const error = reply.error;
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        typeof error.code === 'string' &&
        'safeMessage' in error &&
        typeof error.safeMessage === 'string' &&
        'retryable' in error &&
        typeof error.retryable === 'boolean'
      )
        throw new PraxisError(error.code, error.safeMessage, error.retryable);
    }
  }
  throw new PraxisError('DESKTOP_PROTOCOL_ERROR', '桌面服务响应无效，请重新启动应用。');
}

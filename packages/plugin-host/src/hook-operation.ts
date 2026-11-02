import { PraxisError } from '@praxis/contracts';
/** A hook owns one cooperative cancellation scope; a late result is never published. */
export async function hookOperation<T>(
  action: (signal: AbortSignal) => Promise<T>,
  parent: AbortSignal,
  timeoutMs: number,
): Promise<T> {
  parent.throwIfAborted();
  const scope = new AbortController();
  const abort = () => scope.abort(parent.reason);
  parent.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(
    () => scope.abort(new PraxisError('PLUGIN_TIMEOUT', '插件钩子超过时间限制。')),
    timeoutMs,
  );
  let rejectAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        scope.signal.throwIfAborted();
        return action(scope.signal);
      }),
      new Promise<never>((_resolve, reject) => {
        rejectAbort = () => reject(scope.signal.reason);
        scope.signal.addEventListener('abort', rejectAbort, { once: true });
        if (scope.signal.aborted) rejectAbort();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    parent.removeEventListener('abort', abort);
    if (rejectAbort) scope.signal.removeEventListener('abort', rejectAbort);
    scope.abort();
  }
}

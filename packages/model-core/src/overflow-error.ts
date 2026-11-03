import { z } from 'zod';

const overflow = z.object({ error: z.object({ code: z.literal('context_length_exceeded') }) });

/** Only inspect a small JSON error envelope; remote descriptions are never returned or logged. */
export async function isOverflowResponse(response: Response, parent: AbortSignal) {
  if (!response.body) return false;
  const reader = response.body.getReader();
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 5000);
  const signal = AbortSignal.any([parent, timeout.signal]);
  const cancel = () => {
    void reader.cancel().catch(() => {
      /* Classification remains unknown. */
    });
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json'))
      return false;
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 16384) return false;
      chunks.push(chunk.value);
    }
    return overflow.safeParse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))),
    ).success;
  } catch {
    parent.throwIfAborted();
    return false;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}

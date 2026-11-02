import { assert } from '@praxis/contracts';
import { CompletionAccumulator } from './completion-accumulator.ts';
import type { Completion, ModelRequest } from './types.ts';

export async function readCompletion(
  response: Response,
  request: ModelRequest,
): Promise<Completion> {
  const { signal } = request;
  assert(response.ok && response.body, 'MODEL_EMPTY_RESPONSE', '模型未返回响应流。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  const accumulator = new CompletionAccumulator(request.onDelta);
  let total = 0;
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
        accumulator.consume(buffer.slice(0, newline).replace(/\r$/, ''));
        buffer = buffer.slice(newline + 1);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) accumulator.consume(buffer);
    return accumulator.finish();
  } finally {
    await reader.cancel().catch(() => {
      /* Preserve the primary stream result/error while releasing its lock. */
    });
    reader.releaseLock();
  }
}

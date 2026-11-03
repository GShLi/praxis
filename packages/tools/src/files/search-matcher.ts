import { assert, PraxisError } from '@praxis/contracts';
import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import { regexWorkerSource } from './regex-worker.ts';

const responseSchema = z.union([
  z.object({ error: z.literal('pattern') }),
  z.object({
    matches: z
      .array(
        z.object({ line: z.number().int().nonnegative(), offset: z.number().int().nonnegative() }),
      )
      .max(501),
  }),
]);
/** One sequential search owns this worker; close always terminates outstanding computation. */
export class SearchMatcher {
  private worker: Worker;
  private closed = false;
  constructor(
    private query: { query: string; syntax: 'literal' | 'regex'; caseSensitive: boolean },
  ) {
    assert(!/[\r\n]/.test(query.query), 'INVALID_SEARCH_PATTERN', '搜索表达式只能匹配单行。');
    this.worker = new Worker(regexWorkerSource, {
      eval: true,
      execArgv: [],
      env: {},
      resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8, stackSizeMb: 2 },
    });
  }
  async match(text: string, limit: number, signal: AbortSignal) {
    signal.throwIfAborted();
    assert(!this.closed, 'SEARCH_CLOSED', '搜索已结束。');
    return new Promise<Array<{ line: number; offset: number }>>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        this.worker.off('message', message).off('error', failure).off('exit', exited);
      };
      const failure = () => {
        cleanup();
        reject(new PraxisError('SEARCH_ENGINE_FAILED', '搜索计算线程异常终止。'));
      };
      const exited = () => failure();
      const abort = () => {
        cleanup();
        reject(signal.reason);
      };
      const message = (raw: unknown) => {
        cleanup();
        try {
          const value = responseSchema.parse(raw);
          assert(!('error' in value), 'INVALID_SEARCH_PATTERN', '正则表达式语法无效。');
          resolve(value.matches);
        } catch (error) {
          reject(error);
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new PraxisError(
            'SEARCH_TIMEOUT',
            '单个文件的搜索计算超过 1 秒，请简化表达式或缩小范围。',
          ),
        );
      }, 1000);
      this.worker.once('message', message).once('error', failure).once('exit', exited);
      signal.addEventListener('abort', abort, { once: true });
      this.worker.postMessage({ ...this.query, text, limit });
    });
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.worker.terminate();
  }
}

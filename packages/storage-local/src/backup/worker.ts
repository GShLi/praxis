import { PraxisError } from '@praxis/contracts';
import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import { backupCountsSchema, type DatabaseTask } from './schema.ts';
const resultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    counts: backupCountsSchema,
    storageVersion: z.union([z.literal(2), z.literal(3)]),
  }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.string(), safeMessage: z.string() }),
  }),
]);

/** Packaged applications ship a fixed worker bundle; tsx is only the source-development loader. */
export async function databaseWorker(input: DatabaseTask, cancellation: AbortSignal) {
  const signal = AbortSignal.any([cancellation, AbortSignal.timeout(300000)]);
  signal.throwIfAborted();
  const development = import.meta.url.endsWith('.ts');
  const worker = new Worker(
    development
      ? "const {workerData}=require('node:worker_threads');import('tsx/esm/api').then(({tsImport})=>tsImport(workerData.entry,{parentURL:workerData.parent}));"
      : new URL('./backup-worker.mjs', import.meta.url),
    {
      eval: development,
      execArgv: [],
      stdout: true,
      stderr: true,
      workerData: {
        input,
        entry: new URL('./worker-main.ts', import.meta.url).href,
        parent: import.meta.url,
      },
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    },
  );
  worker.stdout.resume();
  worker.stderr.resume();
  let abort = () => {};
  try {
    return await new Promise<{ counts: z.infer<typeof backupCountsSchema>; storageVersion: 2 | 3 }>(
      (resolve, reject) => {
        abort = () => reject(new PraxisError('BACKUP_CANCELLED', '备份操作已取消或超时。'));
        signal.addEventListener('abort', abort, { once: true });
        worker.once('error', () =>
          reject(new PraxisError('BACKUP_WORKER_FAILED', '数据库备份进程失败。')),
        );
        worker.once('exit', () =>
          reject(new PraxisError('BACKUP_WORKER_FAILED', '数据库备份进程提前退出。')),
        );
        worker.once('message', (raw: unknown) => {
          const result = resultSchema.safeParse(raw);
          if (!result.success)
            reject(new PraxisError('BACKUP_WORKER_FAILED', '备份结果格式无效。'));
          else if (!result.data.ok)
            reject(new PraxisError(result.data.error.code, result.data.error.safeMessage));
          else resolve({ counts: result.data.counts, storageVersion: result.data.storageVersion });
        });
        if (signal.aborted) abort();
      },
    );
  } finally {
    signal.removeEventListener('abort', abort);
    await worker.terminate();
  }
}

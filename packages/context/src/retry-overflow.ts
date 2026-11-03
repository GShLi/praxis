import { assert, PraxisError } from '@praxis/contracts';
import type { ModelClient, ModelRequest } from '@praxis/model-core';

/** One logical step may recover an explicit, pre-output overflow once, using a committed new view. */
export async function completeWithContextRecovery(
  model: ModelClient,
  prepare: (force: boolean) => Promise<{ request: ModelRequest; contextVersion: number }>,
) {
  let previousVersion = -1;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { request, contextVersion } = await prepare(attempt > 0);
    request.signal.throwIfAborted();
    assert(
      !attempt || contextVersion > previousVersion,
      'COMPACTION_NO_PROGRESS',
      '上下文视图未变化，不能重试同一超限请求。',
    );
    previousVersion = contextVersion;
    let published = false;
    try {
      return await model.complete({
        ...request,
        onDelta: (text) => {
          published ||= text.length > 0;
          request.onDelta(text);
        },
      });
    } catch (error) {
      if (
        attempt ||
        published ||
        request.signal.aborted ||
        !(error instanceof PraxisError) ||
        error.code !== 'MODEL_CONTEXT_OVERFLOW'
      )
        throw error;
    }
  }
  throw new PraxisError('MODEL_CONTEXT_OVERFLOW', '压缩后模型仍拒绝超限输入。');
}

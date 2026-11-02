import { PraxisError } from '@praxis/contracts';
import { z } from 'zod';
const schema = z.object({
  error: z.unknown().optional(),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
    })
    .nullish(),
  choices: z
    .array(
      z.object({
        index: z.number().int().nonnegative().optional(),
        delta: z
          .object({
            content: z.string().nullish(),
            reasoning_content: z.string().nullish(),
            tool_calls: z
              .array(
                z.object({
                  index: z.number().int().min(0).max(63),
                  id: z.string().optional(),
                  function: z
                    .object({ name: z.string().optional(), arguments: z.string().optional() })
                    .optional(),
                }),
              )
              .nullish(),
          })
          .optional(),
        finish_reason: z.string().nullish(),
      }),
    )
    .optional(),
});
export function parseCompletionChunk(text: string) {
  try {
    return schema.parse(JSON.parse(text));
  } catch {
    throw new PraxisError('MODEL_PROTOCOL_ERROR', '模型流数据结构无效。');
  }
}

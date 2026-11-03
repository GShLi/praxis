import { z } from 'zod';

const count = z.number().int().nonnegative();
/** Only documented numeric fields are retained; arbitrary provider metadata is not persisted. */
export const providerUsageSchema = z.object({
  prompt_tokens: count.optional(),
  completion_tokens: count.optional(),
  total_tokens: count.optional(),
  prompt_cache_hit_tokens: count.optional(),
  prompt_cache_miss_tokens: count.optional(),
  prompt_tokens_details: z.object({ cached_tokens: count.optional() }).optional(),
  completion_tokens_details: z.object({ reasoning_tokens: count.optional() }).optional(),
});

export const modelUsageSchema = z.strictObject({
  input: count.nullable(),
  output: count.nullable(),
  cacheRead: count.nullable().optional(),
  cacheMiss: count.nullable().optional(),
  reasoning: count.nullable().optional(),
  // Existing adapters reporting input/output remain compatible. Estimated adapters must mark them.
  provenance: z.enum(['reported', 'estimated']).optional(),
  raw: providerUsageSchema.strict().optional(),
});
export type ModelUsage = z.infer<typeof modelUsageSchema>;

/** Each usage chunk is a cumulative snapshot, not a delta. Null counts mean unknown. */
export function normalizeUsage(raw?: z.infer<typeof providerUsageSchema>): ModelUsage {
  return {
    input: raw?.prompt_tokens ?? null,
    output: raw?.completion_tokens ?? null,
    cacheRead: raw?.prompt_cache_hit_tokens ?? raw?.prompt_tokens_details?.cached_tokens ?? null,
    cacheMiss: raw?.prompt_cache_miss_tokens ?? null,
    reasoning: raw?.completion_tokens_details?.reasoning_tokens ?? null,
    provenance: 'reported',
    ...(raw ? { raw } : {}),
  };
}

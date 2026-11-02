import { z } from 'zod';

export const answersSchema = z
  .array(
    z.strictObject({
      id: z.string(),
      selectedOptionId: z.string().optional(),
      text: z.string().max(16384).optional(),
      skipped: z.boolean().default(false),
    }),
  )
  .min(1)
  .max(3);

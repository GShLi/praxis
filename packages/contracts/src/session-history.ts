import { z } from 'zod';
import { idSchema } from './protocol.ts';

export const sessionTitleSchema = z.string().trim().min(1).max(200);

export const sessionListSchema = z.strictObject({
  includeArchived: z.boolean().default(false),
});

export const sessionRenameSchema = z.strictObject({
  sessionId: idSchema,
  title: sessionTitleSchema,
});

export const sessionArchiveSchema = z.strictObject({
  sessionId: idSchema,
  archived: z.boolean().default(true),
});

export const sessionHistoryUpdateSchema = z
  .strictObject({
    title: sessionTitleSchema.optional(),
    archived: z.boolean().optional(),
  })
  .refine((input) => input.title !== undefined || input.archived !== undefined);

export type SessionHistoryUpdate = z.infer<typeof sessionHistoryUpdateSchema>;

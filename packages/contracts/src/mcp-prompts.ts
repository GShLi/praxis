import { z } from 'zod';
import { idSchema, textSchema } from './protocol.ts';
export const mcpPromptEntrySchema = z.object({
  name: z.string().min(1).max(4096),
  description: z.string().max(16384).optional(),
  arguments: z
    .array(
      z.object({
        name: z.string().min(1).max(256),
        description: z.string().max(4096).optional(),
        required: z.boolean().optional(),
      }),
    )
    .max(32)
    .default([]),
});
export type McpPromptEntry = z.infer<typeof mcpPromptEntrySchema>;
export interface McpPromptList {
  generation: string;
  entries: McpPromptEntry[];
  serverId: string;
  configRevision: number;
}
export const mcpPromptGetSchema = z.strictObject({
  sessionId: idSchema,
  serverId: z.uuid(),
  generation: z.string().length(64),
  name: z.string().min(1).max(4096),
  arguments: z.record(z.string().max(256), z.string().max(16384)),
});
export type McpPromptGet = z.infer<typeof mcpPromptGetSchema>;
export const mcpPromptApplySchema = z.strictObject({
  sessionId: idSchema,
  requestId: idSchema,
  previewId: z.uuid(),
  contentHash: z.string().length(64),
  mode: z.enum(['queue', 'steer']).default('queue'),
  expectedTurnId: idSchema.optional(),
});
export type McpPromptApply = z.infer<typeof mcpPromptApplySchema>;
export const mcpPromptPreviewSchema = z.object({
  previewId: z.uuid(),
  serverId: z.uuid(),
  configRevision: z.number().int().positive(),
  name: z.string(),
  contentHash: z.string().length(64),
  text: textSchema,
  expiresAt: z.number(),
});
export type McpPromptPreview = z.infer<typeof mcpPromptPreviewSchema>;

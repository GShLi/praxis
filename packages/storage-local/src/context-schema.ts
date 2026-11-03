import { z } from 'zod';
import type { Message } from '@praxis/contracts';

const id = z.string().min(1).max(256);
export const messageSchema = z
  .object({
    id,
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    content: z.string(),
    toolCalls: z.array(z.object({ id, name: id, arguments: z.string() })).optional(),
    toolCallId: id.optional(),
    reasoning: z.string().optional(),
  })
  .transform((value): Message => {
    const { toolCalls, toolCallId, reasoning, ...message } = value;
    return {
      ...message,
      ...(toolCalls !== undefined ? { toolCalls } : {}),
      ...(toolCallId !== undefined ? { toolCallId } : {}),
      ...(reasoning !== undefined ? { reasoning } : {}),
    };
  });
export const toolProjectionSchema = z.strictObject({
  messageId: id,
  artifactId: id,
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  content: z.string().max(16384),
});
export const contextViewSchema = z.strictObject({
  schemaVersion: z.literal(2).optional(),
  version: z.number().int().nonnegative(),
  summary: messageSchema.nullable(),
  throughMessageId: id.nullable(),
  sources: z.array(id).optional(),
  preservedMessageIds: z.array(id).max(1).optional(),
  toolOutputs: z.array(toolProjectionSchema).max(256).optional(),
});
export type ContextView = z.infer<typeof contextViewSchema>;
export type ContextCandidate = Omit<ContextView, 'version'>;
export type ToolProjection = z.infer<typeof toolProjectionSchema>;

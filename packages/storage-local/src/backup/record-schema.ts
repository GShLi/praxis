import { eventSchema, permissionSchema, userCommandSchema } from '@praxis/contracts';
import { z } from 'zod';
import { messageSchema as message, contextViewSchema as context } from '../context-schema.ts';

const id = z.string().min(1);
const session = z
  .object({
    id,
    ownerUserId: id,
    kind: z.enum(['chat', 'agent']),
    title: z.string(),
    workspace: id.optional(),
    status: z.enum([
      'idle',
      'running',
      'waiting_input',
      'waiting_approval',
      'cancelling',
      'completed',
      'cancelled',
      'failed',
      'interrupted',
    ]),
    latestSeq: z.number().int().nonnegative(),
    createdAt: z.iso.datetime(),
    archived: z.boolean(),
    permission: z.object({
      mode: permissionSchema.shape.mode.unwrap(),
      approval: permissionSchema.shape.approval.unwrap(),
      revision: permissionSchema.shape.revision.unwrap(),
    }),
  })
  .refine((value) => value.kind !== 'agent' || Boolean(value.workspace));
const input = z.object({
  id,
  sessionId: id,
  requestId: id,
  mode: z.enum(['queue', 'steer']),
  text: z.string(),
  expectedTurnId: id.optional(),
  command: userCommandSchema.optional(),
});

/** Serialized v2 rows: validate content consumed by recovery before importing any table. */
export const recordSchemas: Record<string, z.ZodType> = {
  sessions: session,
  messages: message,
  events: eventSchema.refine(
    (event) =>
      !['system/message', 'user/message', 'assistant/message', 'tool/message'].includes(
        event.type,
      ) || message.safeParse(event.payload.message).success,
  ),
  inputs: input,
  contexts: context.refine(
    (value) =>
      value.version > 0 && ((value.summary && value.throughMessageId) || value.toolOutputs?.length),
  ),
  checkpoints: z.object({
    schemaVersion: z.literal(1),
    throughSeq: z.number().int().nonnegative(),
    session,
    context,
    suspended: z.array(
      input.extend({ state: z.literal('suspended'), acceptedSeq: z.number().int() }),
    ),
  }),
  maintenance_operations: z.object({
    operation: z.literal('mcp/test'),
    serverId: id,
    configRevision: z.number().int().positive(),
    startedAt: z.iso.datetime(),
    endedAt: z.iso.datetime().optional(),
    code: z.string().optional(),
  }),
};

import { eventSchema } from '@praxis/contracts';
import { z } from 'zod';
import type { StoreAccess } from './store-access.ts';
import { mcpOperationEvents } from './mcp-operation-events.ts';

const operation = z.object({
  operationId: z.string(),
  callId: z.string(),
  toolId: z.string(),
  serverId: z.string(),
  configRevision: z.number().int().positive(),
});

/** Restore facts only. Transport state and authorization are never reconstructed. */
export function recoverMcpOperations(store: Pick<StoreAccess, 'db' | 'append'>, sessionId: string) {
  const pending = new Map<string, { details: z.infer<typeof operation>; dispatched: boolean }>();
  for (const row of mcpOperationEvents(store.db, sessionId)) {
    const event = eventSchema.parse(JSON.parse(String(row.document)));
    if (event.type === 'mcp/operation-started') {
      const details = operation.parse(event.payload);
      pending.set(details.operationId, { details, dispatched: false });
    } else {
      const { operationId } = z.object({ operationId: z.string() }).parse(event.payload);
      if (event.type === 'mcp/operation-finished') pending.delete(operationId);
      else {
        const current = pending.get(operationId);
        if (current) current.dispatched = true;
      }
    }
  }
  for (const { details, dispatched } of pending.values())
    store.append(sessionId, 'mcp/operation-finished', {
      ...details,
      status: 'interrupted',
      effectState: dispatched ? 'unknown' : 'none',
      code: 'HOST_INTERRUPTED',
      replayed: false,
    });
}

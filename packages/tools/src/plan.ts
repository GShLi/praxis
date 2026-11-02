import { SessionStore } from '@praxis/storage-local';
import { z } from 'zod';
import { planItem } from './schemas.ts';
export function readPlan(
  store: SessionStore,
  sessionId: string,
): { revision: number; items: z.infer<typeof planItem>[] } {
  let after = 0;
  let plan: { revision: number; items: z.infer<typeof planItem>[] } = { revision: 0, items: [] };
  for (;;) {
    const events = store.events(sessionId, after);
    if (!events.length) break;
    for (const event of events)
      if (event.type === 'plan/updated') plan = event.payload as typeof plan;
    after = events.at(-1)!.seq;
  }
  return plan;
}

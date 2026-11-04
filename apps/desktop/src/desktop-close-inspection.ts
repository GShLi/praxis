import type { Session } from '@praxis/contracts';

export type DesktopCloseActivity = { kind: 'known'; activeCount: number } | { kind: 'unknown' };

interface SessionReader {
  request(method: string, params: unknown, timeoutMs: number): Promise<unknown>;
}

const activeStatuses: ReadonlySet<Session['status']> = new Set([
  'running',
  'waiting_input',
  'waiting_approval',
  'cancelling',
]);
const inactiveStatuses: ReadonlySet<Session['status']> = new Set([
  'idle',
  'completed',
  'cancelled',
  'failed',
  'interrupted',
]);

function readStatus(value: unknown): Session['status'] | undefined {
  for (const status of [...activeStatuses, ...inactiveStatuses])
    if (value === status) return status;
  return undefined;
}

/** session/list is scoped to the identity owned by this desktop Host. */
export async function inspectDesktopCloseActivity(
  rpc: SessionReader | undefined,
): Promise<DesktopCloseActivity> {
  if (!rpc) return { kind: 'known', activeCount: 0 };
  try {
    const sessions = await rpc.request('session/list', { includeArchived: true }, 3000);
    // session/list returns at most 100 rows and has no continuation cursor. A full
    // page cannot establish a total: older active sessions may not be represented.
    if (!Array.isArray(sessions) || sessions.length >= 100) return { kind: 'unknown' };
    const records: unknown[] = sessions;
    const ids = new Set<string>();
    let activeCount = 0;
    for (const session of records) {
      if (
        typeof session !== 'object' ||
        session === null ||
        !('status' in session) ||
        !('id' in session)
      )
        return { kind: 'unknown' };
      const status = readStatus(session.status);
      if (typeof session.id !== 'string' || !session.id || ids.has(session.id) || !status)
        return { kind: 'unknown' };
      ids.add(session.id);
      if (activeStatuses.has(status)) activeCount++;
    }
    return { kind: 'known', activeCount };
  } catch {
    // A disconnected, unbound or unresponsive Host is not evidence of zero tasks.
    return { kind: 'unknown' };
  }
}

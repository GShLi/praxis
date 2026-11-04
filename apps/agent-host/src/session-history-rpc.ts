import { assert, sessionArchiveSchema, sessionRenameSchema } from '@praxis/contracts';
import type { Session } from '@praxis/contracts';
import type { HostIdentity } from './identity.ts';
import type { RpcRoutes } from './rpc-schema.ts';

function updateHistory(
  identity: HostIdentity,
  sessionId: string,
  patch: Partial<Pick<Session, 'title' | 'archived'>>,
) {
  const { store, runtime, owner } = identity.require();
  store.get(sessionId, owner);
  assert(!runtime.getTurn(sessionId), 'SESSION_BUSY', '请先停止当前任务。');
  return store.update(sessionId, patch);
}

export function sessionHistoryRoutes(identity: HostIdentity): RpcRoutes {
  return {
    'session/rename': async (params: unknown) => {
      identity.require();
      const input = sessionRenameSchema.parse(params);
      return updateHistory(identity, input.sessionId, { title: input.title });
    },
    'session/archive': async (params: unknown) => {
      identity.require();
      const input = sessionArchiveSchema.parse(params);
      return updateHistory(identity, input.sessionId, { archived: input.archived });
    },
  };
}

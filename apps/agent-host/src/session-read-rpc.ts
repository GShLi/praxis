import { readEffectiveConfig } from '@praxis/agent-runtime';
import { idSchema } from '@praxis/contracts';
import { z } from 'zod';
import type { HostIdentity } from './identity.ts';
import { noArgs, sessionArg, type RpcRoutes } from './rpc-schema.ts';

function sessionSnapshot(identity: HostIdentity, params: unknown) {
  const { store, runtime, owner } = identity.require();
  const input = sessionArg.parse(params);
  const session = store.get(input.sessionId, owner);
  return {
    session,
    messages: store.timeline(session.id),
    suspended: store.inputs(session.id, 'suspended'),
    contextVersion: store.context(session.id).version,
    throughSeq: session.latestSeq,
    turnId: runtime.getTurn(session.id) ?? null,
    question: runtime.pendingQuestion(session.id),
    approval: runtime.approvals.snapshot(session.id),
  };
}
export function sessionReadRoutes(identity: HostIdentity): RpcRoutes {
  return {
    'session/list': async (params: unknown) => {
      const { store, owner } = identity.require();
      noArgs.parse(params);
      return store.list(owner);
    },
    'session/read': async (params: unknown) => sessionSnapshot(identity, params),
    'session/config': async (params: unknown) => {
      const { store, owner } = identity.require();
      const { sessionId } = sessionArg.parse(params);
      const session = store.get(sessionId, owner);
      return {
        snapshot: readEffectiveConfig(store, session.id),
        currentPermission: session.permission,
      };
    },
    'artifact/read': async (params: unknown) => {
      const { store, owner } = identity.require();
      const input = z.strictObject({ sessionId: idSchema, artifactId: idSchema }).parse(params);
      store.get(input.sessionId, owner);
      return store.readArtifact(input.sessionId, input.artifactId);
    },
  };
}

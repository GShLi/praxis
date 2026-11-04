import { readEffectiveConfig } from '@praxis/agent-runtime';
import { idSchema, sessionListSchema } from '@praxis/contracts';
import { z } from 'zod';
import type { HostIdentity } from './identity.ts';
import { sessionArg, type RpcRoutes } from './rpc-schema.ts';

function sessionSnapshot(identity: HostIdentity, params: unknown) {
  const { store, runtime, owner } = identity.require();
  const input = sessionArg.parse(params);
  const session = store.get(input.sessionId, owner);
  const events = store.events(session.id, Math.max(0, session.latestSeq - 200), 200);
  for (const type of ['turn/started', 'turn/finished']) {
    const boundary = store.latestEvent(session.id, type);
    if (boundary && !events.some((event) => event.seq === boundary.seq)) events.push(boundary);
  }
  return {
    session,
    messages: store.timeline(session.id),
    suspended: store.inputs(session.id, 'suspended'),
    pendingInputs: store
      .inputs(session.id, 'pending')
      .map(({ id, text, mode }) => ({ id, text, mode })),
    contextVersion: store.context(session.id).version,
    throughSeq: session.latestSeq,
    turnId: runtime.getTurn(session.id) ?? null,
    question: runtime.pendingQuestion(session.id),
    approval: runtime.approvals.snapshot(session.id),
    events: events.filter((event) =>
      ['turn/started', 'turn/finished', 'tool/intent', 'tool/result'].includes(event.type),
    ),
  };
}
export function sessionReadRoutes(identity: HostIdentity): RpcRoutes {
  return {
    'session/list': async (params: unknown) => {
      const { store, owner } = identity.require();
      const input = sessionListSchema.parse(params);
      return store.list(owner, 100, input);
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

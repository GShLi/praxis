import { startHost } from '@praxis/client-host';
import type { Session } from '@praxis/contracts';
import { assert } from '@praxis/contracts';
import type { CliOptions } from './options.ts';
export async function prepareSession(
  host: Awaited<ReturnType<typeof startHost>>,
  values: CliOptions,
) {
  let sessionId = '';
  if (values.resume) {
    const result = await host.rpc.request<{ session: Session }>('session/read', {
      sessionId: values.resume,
    });
    assert(result.session.kind === 'agent', 'MODE_UNAVAILABLE', 'CLI 只支持 Agent 会话。');
    sessionId = result.session.id;
  } else {
    const workspace = await host.rpc.request<{ id: string }>('workspace/open', {
      path: values.workspace ?? process.cwd(),
    });
    const session = await host.rpc.request<Session>('session/create', {
      kind: 'agent',
      workspaceId: workspace.id,
    });
    sessionId = session.id;
  }
  if (values['read-only']) {
    const state = await host.rpc.request<{ session: Session }>('session/read', { sessionId });
    await host.rpc.request('session/set-permissions', {
      sessionId,
      expectedRevision: state.session.permission.revision,
      permission: { ...state.session.permission, mode: 'read-only' },
    });
  }

  return sessionId;
}

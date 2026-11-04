import { useState } from 'react';
import type { McpState } from '../client-types.ts';

type Server = McpState['value'][number];
function draftFor(initial?: Server) {
  return {
    name: initial?.displayName ?? '',
    namespace: initial?.namespace ?? '',
    endpoint: initial?.transport.endpoint ?? '',
    privateHost: initial?.transport.allowPrivateDestination ?? false,
    resources: initial?.capabilities?.resources ?? false,
    prompts: initial?.capabilities?.prompts ?? false,
    tools: initial?.capabilities?.tools ?? true,
    protocol: initial?.protocol ?? 'auto',
  };
}

export function useMcpEditor(initial?: Server) {
  const [baseline] = useState(() => draftFor(initial));
  const [draft, setDraft] = useState(baseline);
  const [id] = useState(() => initial?.id ?? crypto.randomUUID());
  return {
    draft,
    change: (patch: Partial<typeof draft>) => setDraft((value) => ({ ...value, ...patch })),
    dirty: JSON.stringify(draft) !== JSON.stringify(baseline),
    config: () => ({
      id,
      namespace: draft.namespace,
      displayName: draft.name,
      revision: initial?.revision ?? 1,
      enabled: false,
      protocol: draft.protocol,
      transport: {
        type: 'streamable-http',
        endpoint: draft.endpoint,
        allowPrivateDestination: draft.privateHost,
        auth: { type: 'none' },
      },
      capabilities: { tools: draft.tools, resources: draft.resources, prompts: draft.prompts },
    }),
  };
}

import { assert, type ToolCall, type ToolResult } from '@praxis/contracts';
import type { ActivePlugin } from '@praxis/plugin-host';
import { SessionStore, uuid } from '@praxis/storage-local';
import { schemas } from './schemas.ts';
export async function invokePlugin(
  plugin: ActivePlugin,
  call: ToolCall,
  callId: string,
  raw: unknown,
  signal: AbortSignal,
  sessionId: string,
  store: Pick<SessionStore, 'append'>,
  execute: (call: ToolCall, id: string, signal: AbortSignal) => Promise<ToolResult>,
  consume?: () => void,
) {
  return await plugin.tools.get(call.name)!.execute(raw, {
    signal,
    invokeCore: async (name, args) => {
      assert(
        Object.hasOwn(schemas, name),
        'TOOL_NOT_AVAILABLE',
        '插件只能通过此服务调用核心工具。',
      );
      consume?.();
      const delegatedId = uuid();
      store.append(sessionId, 'plugin/tool-intent', {
        pluginId: plugin.manifest.id,
        parentCallId: callId,
        delegatedId,
        name,
      });
      const value = await execute(
        { id: delegatedId, name, arguments: JSON.stringify(args) },
        delegatedId,
        signal,
      );
      store.append(
        sessionId,
        'plugin/tool-result',
        { pluginId: plugin.manifest.id, parentCallId: callId, result: value },
        'tool',
      );
      return value;
    },
  });
}

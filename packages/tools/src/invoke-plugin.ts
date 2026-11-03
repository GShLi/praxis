import { assert, type ToolCall, type ToolResult } from '@praxis/contracts';
import type { ActivePlugin } from '@praxis/plugin-host';
import { SessionStore, uuid } from '@praxis/storage-local';
import { schemas } from './schemas.ts';
export async function invokePlugin(
  plugin: ActivePlugin,
  call: ToolCall,
  raw: unknown,
  services: ReturnType<typeof delegatedServices>,
) {
  return await plugin.tools.get(call.name)!.execute(raw, services);
}
export function delegatedServices(
  pluginId: string,
  callId: string,
  signal: AbortSignal,
  sessionId: string,
  store: Pick<SessionStore, 'append'>,
  execute: (call: ToolCall, id: string, signal: AbortSignal) => Promise<ToolResult>,
  consume?: () => void,
) {
  return {
    signal,
    invokeCore: async (name: string, args: Record<string, unknown>) => {
      signal.throwIfAborted();
      assert(
        Object.hasOwn(schemas, name),
        'TOOL_NOT_AVAILABLE',
        '插件只能通过此服务调用核心工具。',
      );
      consume?.();
      const delegatedId = uuid();
      store.append(sessionId, 'plugin/tool-intent', {
        pluginId,
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
        { pluginId, parentCallId: callId, result: value },
        'tool',
      );
      return value;
    },
  };
}

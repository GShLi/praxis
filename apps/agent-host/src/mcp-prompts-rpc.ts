import { assert, idSchema, mcpPromptApplySchema, mcpPromptGetSchema } from '@praxis/contracts';
import { z } from 'zod';
import type { HostIdentity } from './identity.ts';
import type { RpcRoutes } from './rpc-schema.ts';
export function mcpPromptsRoutes(identity: HostIdentity): RpcRoutes {
  const service = () => {
    identity.require();
    assert(identity.mcpPrompts, 'MCP_UNAVAILABLE', 'MCP 尚未初始化。');
    return identity.mcpPrompts;
  };
  return {
    'mcp/prompt-list': async (params) => {
      const input = z.strictObject({ sessionId: idSchema, serverId: z.uuid() }).parse(params);
      return service().list(input.sessionId, input.serverId);
    },
    'mcp/prompt-preview': async (params) => {
      const input = mcpPromptGetSchema.parse(params);
      const prompts = service();
      await identity.require().auth.profile(AbortSignal.timeout(15000));
      return prompts.preview(input);
    },
    'mcp/prompt-apply': async (params) => {
      const input = mcpPromptApplySchema.parse(params);
      const prompts = service();
      assert(
        !identity.pluginsChanged,
        'HOST_RESTART_REQUIRED',
        '插件配置已变化，请重新登录后执行任务。',
      );
      await identity.require().auth.profile(AbortSignal.timeout(15000));
      return prompts.apply(input);
    },
    'mcp/prompt-cancel': async (params) => {
      const { store, owner } = identity.require();
      const input = z.strictObject({ sessionId: idSchema }).parse(params);
      store.get(input.sessionId, owner);
      identity.mcpRuntime?.cancelUserOperations(input.sessionId);
      return { accepted: true };
    },
  };
}

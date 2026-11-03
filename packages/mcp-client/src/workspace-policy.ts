import { assert, workspaceMcpSchema, type WorkspaceMcpConfig } from '@praxis/contracts';
import type { Catalog, McpConfig } from '@praxis/mcp-core';

/** A turn owns a copy of project restrictions; these can only narrow user-enabled connections. */
export class WorkspaceMcpPolicy {
  private bindings: Map<string, Set<string> | undefined> | undefined;
  constructor(input?: WorkspaceMcpConfig) {
    if (input)
      this.bindings = new Map(
        workspaceMcpSchema
          .parse(input)
          .servers.map((server) => [
            server.serverId,
            server.tools ? new Set(server.tools) : undefined,
          ]),
      );
  }
  select(configs: readonly McpConfig[]) {
    const enabled = configs.filter((config) => config.enabled);
    if (!this.bindings) return enabled;
    for (const id of this.bindings.keys())
      assert(
        enabled.some((config) => config.id === id),
        'WORKSPACE_MCP_UNAVAILABLE',
        '工作区引用的 MCP 连接未启用或不存在，请先在个人设置中检查并启用。',
      );
    return enabled.filter((config) => this.bindings?.has(config.id));
  }
  toolsEnabled(serverId: string) {
    return (
      !this.bindings || (this.bindings.has(serverId) && this.bindings.get(serverId)?.size !== 0)
    );
  }
  allows(serverId: string, rawName: string) {
    const allowed = this.bindings?.get(serverId);
    return this.toolsEnabled(serverId) && (!allowed || allowed.has(rawName));
  }
  toolConfigs(configs: readonly McpConfig[]) {
    return configs.filter((config) => this.toolsEnabled(config.id));
  }
  catalog(catalog: Catalog): Catalog {
    return {
      ...catalog,
      tools: catalog.tools.filter((tool) => this.allows(catalog.binding.serverId, tool.rawName)),
    };
  }
}

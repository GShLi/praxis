import type { ToolDefinition } from '@praxis/contracts';
import type { McpConfig } from '@praxis/mcp-core';
import { z } from 'zod';

export const discovery = z.strictObject({
  serverId: z.uuid(),
  query: z.string().max(256).default(''),
  limit: z.number().int().min(1).max(8).default(5),
});
export function discoveryDefinition(configs: readonly McpConfig[]): ToolDefinition | undefined {
  const servers = configs.filter((c) => c.capabilities.tools);
  if (!servers.length) return undefined;
  return {
    id: 'mcp.discover_tools',
    modelName: 'mcp_discover_tools',
    description:
      'Discover enabled MCP tools; selected tools become available in the next step. Servers: ' +
      JSON.stringify(servers.map((c) => ({ id: c.id, name: c.displayName.slice(0, 120) }))),
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['serverId'],
      properties: {
        serverId: { type: 'string', enum: servers.map((c) => c.id) },
        query: { type: 'string', maxLength: 256 },
        limit: { type: 'integer', minimum: 1, maximum: 8 },
      },
    },
  };
}

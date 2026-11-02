import type { ToolDefinition } from '@praxis/contracts';
import type { McpConfig } from '@praxis/mcp-core';
import { z } from 'zod';

const ref = z.string().min(1).max(128);
export const resourceListSchema = z.strictObject({
  serverId: ref,
  kind: z.enum(['resources', 'templates']).default('resources'),
  cursor: ref.optional(),
  limit: z.number().int().min(1).max(50).default(20),
});
export const resourceReadSchema = z.union([
  z.strictObject({ resourceRef: ref }),
  z.strictObject({ templateRef: ref, arguments: z.record(z.string(), z.string().max(4096)) }),
]);
// JSON object keys are already strings; avoid Zod's redundant propertyNames keyword in the model projection.
const referenceParameter = { type: 'string', minLength: 1, maxLength: 128 };
const readParameters = {
  type: 'object',
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['resourceRef'],
      properties: { resourceRef: referenceParameter },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['templateRef', 'arguments'],
      properties: {
        templateRef: referenceParameter,
        arguments: { type: 'object', additionalProperties: { type: 'string', maxLength: 4096 } },
      },
    },
  ],
};
export function resourceDefinitions(configs: readonly McpConfig[]): ToolDefinition[] {
  const servers = configs
    .filter((c) => c.capabilities.resources)
    .map((c) => ({ id: c.id, name: c.displayName.slice(0, 120) }));
  if (!servers.length) return [];
  return [
    {
      id: 'mcp.list_resources',
      modelName: 'mcp_list_resources',
      description:
        'List remote MCP resources or templates. References belong to this turn. Servers: ' +
        JSON.stringify(servers),
      parameters: z.toJSONSchema(resourceListSchema, { io: 'input' }),
    },
    {
      id: 'mcp.read_resource',
      modelName: 'mcp_read_resource',
      description:
        'Read a listed MCP resource, with approval. URIs are handled by the remote server, never as local paths or direct HTTP requests.',
      parameters: readParameters,
    },
  ];
}

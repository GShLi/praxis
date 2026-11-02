import { assert } from '@praxis/contracts';
import { normalizeResult, type CatalogTool } from '@praxis/mcp-core';
import type { McpConnection } from './connection.ts';
import { mcpError } from './errors.ts';

export async function callRemoteTool(
  connection: McpConnection,
  tool: CatalogTool,
  input: unknown,
  signal: AbortSignal,
) {
  tool.validate(input);
  assert(
    input && typeof input === 'object' && !Array.isArray(input),
    'INVALID_ARGUMENT',
    'MCP 工具参数必须是对象。',
  );
  try {
    const raw = await connection.client.callTool(
      { name: tool.rawName, arguments: input as Record<string, unknown> },
      {
        signal,
        timeout: 60_000,
        maxTotalTimeout: 60_000,
        resetTimeoutOnProgress: false,
        toolDefinition: {
          name: tool.rawName,
          inputSchema: { ...tool.wireParameters, type: 'object' },
          ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
        },
      },
    );
    signal.throwIfAborted();
    return normalizeResult(raw, tool.outputSchema);
  } catch (error) {
    throw mcpError(error, signal);
  }
}

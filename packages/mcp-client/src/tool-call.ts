import { assert, PraxisError } from '@praxis/contracts';
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
    const raw = await connection.interact((continuation) =>
      connection.client.callTool(
        { name: tool.rawName, arguments: input as Record<string, unknown>, ...continuation },
        {
          signal,
          allowInputRequired: true,
          timeout: 60_000,
          maxTotalTimeout: 60_000,
          resetTimeoutOnProgress: false,
          toolDefinition: {
            name: tool.rawName,
            inputSchema: { ...tool.wireParameters, type: 'object' },
            // The final normalized result validates outputSchema; intermediate MRTR results have none.
          },
        },
      ),
    );
    signal.throwIfAborted();
    try {
      return normalizeResult(raw, tool.outputSchema);
    } catch (error) {
      if (error instanceof PraxisError && error.code === 'INVALID_ARGUMENT')
        throw new PraxisError('MCP_PROTOCOL_FAILED', '服务器结果不符合声明的输出格式。');
      throw error;
    }
  } catch (error) {
    throw mcpError(error, signal);
  }
}

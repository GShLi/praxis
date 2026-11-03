import type { startHost } from '@praxis/client-host';
import { assert, type McpPromptList } from '@praxis/contracts';
import { randomUUID } from 'node:crypto';
type Host = Awaited<ReturnType<typeof startHost>>;
export async function previewPrompt(
  host: Host,
  sessionId: string,
  serverId: string,
  name: string,
  args: unknown,
) {
  const catalog = await host.rpc.request<McpPromptList>('mcp/prompt-list', { sessionId, serverId });
  return host.rpc.request('mcp/prompt-preview', {
    sessionId,
    serverId,
    generation: catalog.generation,
    name,
    arguments: args,
  });
}
export class CliMcpPrompts {
  constructor(
    private host: Host,
    private sessionId: string,
  ) {}
  async input(line: string): Promise<'read' | 'submitted' | false> {
    if (line.startsWith('/mcp-prompts ')) {
      const serverId = line.slice('/mcp-prompts '.length).trim();
      console.log(
        JSON.stringify(
          await this.host.rpc.request('mcp/prompt-list', { sessionId: this.sessionId, serverId }),
          null,
          2,
        ),
      );
      return 'read';
    }
    if (line.startsWith('/mcp-preview ')) {
      const match = /^\/mcp-preview (\S+) ([\s\S]+)$/.exec(line);
      assert(
        match,
        'INVALID_COMMAND',
        '格式：/mcp-preview SERVER_ID {"name":"模板名称","arguments":{}}',
      );
      const value: unknown = JSON.parse(match[2]!);
      assert(
        value && typeof value === 'object' && 'name' in value && typeof value.name === 'string',
        'INVALID_ARGUMENT',
        '需要模板 name 和 arguments。',
      );
      const result = await previewPrompt(
        this.host,
        this.sessionId,
        match[1]!,
        value.name,
        'arguments' in value ? value.arguments : {},
      );
      console.log(JSON.stringify(result, null, 2));
      console.log('检查完整 text 后使用 /mcp-apply PREVIEW_ID CONTENT_HASH [queue|steer] 确认。');
      return 'read';
    }
    if (line.startsWith('/mcp-apply ')) {
      const match = /^\/mcp-apply (\S+) (\S+)(?: (queue|steer))?$/.exec(line);
      assert(match, 'INVALID_COMMAND', '格式：/mcp-apply PREVIEW_ID CONTENT_HASH [queue|steer]');
      const mode = match[3] ?? 'queue';
      const current =
        mode === 'steer'
          ? await this.host.rpc.request<{ turnId: string | null }>('session/read', {
              sessionId: this.sessionId,
            })
          : undefined;
      await this.host.rpc.request('mcp/prompt-apply', {
        sessionId: this.sessionId,
        requestId: randomUUID(),
        previewId: match[1],
        contentHash: match[2],
        mode,
        ...(current?.turnId ? { expectedTurnId: current.turnId } : {}),
      });
      return 'submitted';
    }
    return false;
  }
}

export async function mcpPromptCommand(host: Host, positionals: string[], argsText = '{}') {
  const action = positionals[1];
  if (action !== 'list-prompts' && action !== 'preview') return false;
  const sessionId = positionals[2],
    serverId = positionals[3];
  assert(sessionId && serverId, 'INVALID_ARGUMENT', '需要 Session ID 和服务器 ID。');
  let result: unknown;
  if (action === 'list-prompts')
    result = await host.rpc.request('mcp/prompt-list', { sessionId, serverId });
  else {
    assert(positionals[4], 'INVALID_ARGUMENT', '需要提示词名称。');
    result = await previewPrompt(host, sessionId, serverId, positionals[4], JSON.parse(argsText));
  }
  console.log(JSON.stringify(result, null, 2));
  return true;
}

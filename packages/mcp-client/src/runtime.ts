import type { FetchLike } from '@modelcontextprotocol/client';
import { assert, type Session } from '@praxis/contracts';
import type { McpConfigService } from '@praxis/mcp-core';
import type { Approve } from '@praxis/permissions';
import type { SessionStore } from '@praxis/storage-local';
import { McpTurnScope } from './turn-scope.ts';
import { McpTurnTools } from './turn-tools.ts';

export class McpRuntime {
  private turns = new Set<McpTurnScope>();
  private closed = false;
  constructor(
    private configs: McpConfigService,
    private store: SessionStore,
    private client: string,
    private fetch?: FetchLike,
  ) {}
  async create(
    session: Session,
    contextWindow: number,
    approve: Approve,
    signal: AbortSignal,
    sensitiveValues: readonly string[] = [],
  ) {
    assert(!this.closed && session.kind === 'agent', 'MCP_UNAVAILABLE', '此执行范围不能使用 MCP。');
    const configs = (await this.configs.file.read()).value.filter(
      (c) => c.enabled && (c.capabilities.tools || c.capabilities.resources),
    );
    signal.throwIfAborted();
    assert(!this.closed, 'MCP_UNAVAILABLE', 'MCP 已关闭。');
    const scope = new McpTurnScope(configs, {
      configs: this.configs,
      owner: session.ownerUserId,
      client: this.client,
      signal,
      approve,
      sensitiveValues,
      record: (type, data) => this.store.append(session.id, type, data),
      artifact: (kind, content) => this.store.artifact(session.id, kind, content),
      ...(this.fetch ? { fetch: this.fetch } : {}),
    });
    this.turns.add(scope);
    return new McpTurnTools(scope, contextWindow, () => this.turns.delete(scope));
  }
  invalidate(serverId: string) {
    for (const turn of this.turns) turn.invalidate(serverId);
  }
  async close() {
    this.closed = true;
    await Promise.allSettled([...this.turns].map((t) => t.close()));
    this.turns.clear();
  }
}

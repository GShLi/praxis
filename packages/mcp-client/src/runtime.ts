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
  private controls = new Map<McpTurnScope, string>();
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
  async userOperation<T>(
    session: Session,
    action: (scope: McpTurnScope) => Promise<T>,
    sensitiveValues: readonly string[] = [],
  ) {
    assert(
      !this.closed && session.kind === 'agent',
      'MCP_UNAVAILABLE',
      'ChatBot 不连接 MCP，或 MCP 已关闭。',
    );
    const configs = (await this.configs.file.read()).value.filter(
      (c) => c.enabled && c.capabilities.prompts,
    );
    assert(!this.closed, 'MCP_UNAVAILABLE', 'MCP 已关闭。');
    assert(this.turns.size < 8, 'MCP_BUSY', 'MCP 操作数量已达到上限。');
    const scope = new McpTurnScope(configs, {
      configs: this.configs,
      owner: session.ownerUserId,
      client: this.client,
      signal: AbortSignal.timeout(300000),
      // This API is reachable only from an explicit user preview request, never a model tool.
      approve: async () => () => {},
      sensitiveValues,
      record: (type, data) => this.store.append(session.id, type, data),
      artifact: (kind, content) => this.store.artifact(session.id, kind, content),
      ...(this.fetch ? { fetch: this.fetch } : {}),
    });
    this.turns.add(scope);
    this.controls.set(scope, session.id);
    try {
      return await action(scope);
    } finally {
      await scope.close();
      this.turns.delete(scope);
      this.controls.delete(scope);
    }
  }
  cancelUserOperations(sessionId: string) {
    for (const [scope, id] of this.controls) if (id === sessionId) scope.cancel();
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

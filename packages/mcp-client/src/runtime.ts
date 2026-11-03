import type { ResolveCredentials } from './credentials/service.ts';
import type { Ask } from '@praxis/tools';
import type { FetchLike } from '@modelcontextprotocol/client';
import { assert, type Session } from '@praxis/contracts';
import type { McpConfigService } from '@praxis/mcp-core';
import type { Approve } from '@praxis/permissions';
import type { SessionStore } from '@praxis/storage-local';
import { McpTurnScope } from './turn-scope.ts';
import { McpTurnTools } from './turn-tools.ts';

export interface UserInteraction {
  signal: AbortSignal;
  ask?: Ask;
  approve: Approve;
  close(): void;
}
export class McpRuntime {
  private turns = new Set<McpTurnScope>();
  private closed = false;
  private controls = new Map<McpTurnScope, string>();
  constructor(
    private configs: McpConfigService,
    private store: SessionStore,
    private client: string,
    private fetch?: FetchLike,
    private interaction?: (session: Session) => UserInteraction,
    private credentials?: ResolveCredentials,
  ) {}
  async create(
    session: Session,
    contextWindow: number,
    approve: Approve,
    signal: AbortSignal,
    sensitiveValues: readonly string[] = [],
    ask?: Ask,
  ) {
    assert(!this.closed && session.kind === 'agent', 'MCP_UNAVAILABLE', '此执行范围不能使用 MCP。');
    const configs = (await this.configs.file.read()).value.filter(
      (c) => c.enabled && (c.capabilities.tools || c.capabilities.resources),
    );
    signal.throwIfAborted();
    assert(!this.closed, 'MCP_UNAVAILABLE', 'MCP 已关闭。');
    const scope = new McpTurnScope(configs, {
      configs: this.configs,
      ...(this.credentials ? { credentials: this.credentials } : {}),
      owner: session.ownerUserId,
      client: this.client,
      signal,
      approve,
      sensitiveValues,
      ...(ask ? { ask } : {}),
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
    const interaction = this.interaction?.(session);
    const scope = new McpTurnScope(configs, {
      configs: this.configs,
      ...(this.credentials ? { credentials: this.credentials } : {}),
      owner: session.ownerUserId,
      client: this.client,
      signal: AbortSignal.any([
        AbortSignal.timeout(300000),
        ...(interaction ? [interaction.signal] : []),
      ]),
      ...(interaction?.ask ? { ask: interaction.ask } : {}),
      ...(interaction ? { continueApproval: interaction.approve } : {}),
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
      interaction?.close();
      this.turns.delete(scope);
      this.controls.delete(scope);
    }
  }
  async cancelUserOperations(sessionId: string) {
    const pending = [...this.controls]
      .filter(([, id]) => id === sessionId)
      .map(([scope]) => scope.close());
    await Promise.allSettled(pending);
  }
  invalidate(serverId: string) {
    for (const turn of this.turns) turn.invalidate(serverId);
  }
  invalidateAuthentication(serverId: string, epoch: number) {
    for (const turn of this.turns) turn.invalidateAuthentication(serverId, epoch);
  }
  async close() {
    this.closed = true;
    await Promise.allSettled([...this.turns].map((t) => t.close()));
    this.turns.clear();
  }
}

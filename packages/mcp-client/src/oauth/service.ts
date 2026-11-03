import { assert, mcpOAuthStartSchema, type McpOAuthStart } from '@praxis/contracts';
import type { McpConfig } from '@praxis/mcp-core';
import type { CredentialRecords } from '../credentials/records.ts';
import { OAuthAccounts } from './accounts.ts';
import { OAuthFlow } from './flow.ts';
import { containsSecret } from '../form.ts';

export class McpOAuth {
  private flows = new Map<string, OAuthFlow>();
  private accounts: OAuthAccounts;
  constructor(
    private records: CredentialRecords,
    private protectedValues: readonly string[],
    changed: (serverId: string, epoch: number) => void,
  ) {
    this.accounts = new OAuthAccounts(records, protectedValues, changed);
  }
  async start(raw: McpOAuthStart) {
    this.records.signal.throwIfAborted();
    const input = mcpOAuthStartSchema.parse(raw);
    assert(
      !containsSecret(input, this.protectedValues),
      'MCP_SECRET_DENIED',
      'OAuth 注册信息不能包含已知秘密。',
    );
    const active = [...this.flows.values()].filter((f) =>
      ['waiting', 'exchanging'].includes(f.status().status),
    );
    assert(
      active.length < 4 && !active.some((f) => f.input.serverId === input.serverId),
      'MCP_OAUTH_BUSY',
      '此服务器已有授权流程，或并发授权数量达到上限。',
    );
    for (const [id, flow] of this.flows) {
      if (this.flows.size < 32) break;
      if (!['waiting', 'exchanging'].includes(flow.status().status)) this.flows.delete(id);
    }
    const flow = new OAuthFlow(input, this.records, this.protectedValues);
    this.flows.set(flow.id, flow);
    return flow.started;
  }
  private get(id: string) {
    const flow = this.flows.get(id);
    assert(flow, 'MCP_OAUTH_NOT_FOUND', '授权流程不存在或已过期。');
    return flow;
  }
  status(id: string) {
    return this.get(id).status();
  }
  wait(id: string) {
    return this.get(id).completed;
  }
  async cancel(id: string) {
    const flow = this.get(id);
    flow.cancel();
    return flow.completed;
  }
  invalidate(serverId: string) {
    this.accounts.invalidate(serverId);
    for (const flow of this.flows.values())
      if (flow.input.serverId === serverId && !flow.committing) flow.cancel();
  }
  resolve(config: McpConfig, signal: AbortSignal) {
    return this.accounts.resolve(config, signal);
  }
  async close() {
    for (const flow of this.flows.values()) flow.cancel();
    await Promise.allSettled([...this.flows.values()].map((flow) => flow.completed));
    await this.accounts.close();
    this.flows.clear();
  }
}

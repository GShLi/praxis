import {
  assert,
  mcpPromptGetSchema,
  mcpPromptApplySchema,
  type Prompt,
  type McpPromptGet,
  type McpPromptApply,
  type McpPromptPreview,
} from '@praxis/contracts';
import { fingerprint } from '@praxis/config';
import type { McpConfigService } from '@praxis/mcp-core';
import type { SessionStore } from '@praxis/storage-local';
import { randomUUID } from 'node:crypto';
import type { McpRuntime } from './runtime.ts';
import { promptCatalog, validatePromptArguments } from './prompt-catalog.ts';
import { promptPreview, storedPreviewSchema } from './prompt-preview.ts';
type Submit = (
  prompt: Prompt,
  validate: () => void,
) => { accepted: true; inputId: string; acceptedSeq: number };

/** User control surface only. Not registered in the model toolset. */
export class McpPrompts {
  private closed = false;
  close() {
    this.closed = true;
  }
  private ensureOpen() {
    assert(!this.closed, 'MCP_CLOSED', 'MCP 已关闭。');
  }
  constructor(
    private runtime: McpRuntime,
    private configs: McpConfigService,
    private store: SessionStore,
    private owner: string,
    private submit: Submit,
    private sensitiveValues: readonly string[] = [],
  ) {}
  async list(sessionId: string, serverId: string) {
    this.ensureOpen();
    const session = this.store.get(sessionId, this.owner);
    return this.runtime.userOperation(
      session,
      async (scope) =>
        scope.run(
          serverId,
          randomUUID(),
          'mcp.list_prompts',
          {},
          async ({ connection, signal, authorize, operationId }) => {
            await authorize();
            const catalog = await promptCatalog(connection, signal);
            const artifactId = scope.artifact('mcp-prompt-catalog', JSON.stringify(catalog));
            scope.record('mcp/prompt-catalog', {
              operationId,
              artifactId,
              serverId,
              generation: catalog.generation,
            });
            return catalog;
          },
          { capability: 'prompts', metadataOnly: true },
        ),
      this.sensitiveValues,
    );
  }
  async preview(raw: McpPromptGet): Promise<McpPromptPreview> {
    this.ensureOpen();
    const input = mcpPromptGetSchema.parse(raw);
    const session = this.store.get(input.sessionId, this.owner);
    return this.runtime.userOperation(
      session,
      async (scope) =>
        scope.run(
          input.serverId,
          randomUUID(),
          'mcp.get_prompt',
          input,
          async ({ connection, signal, authorize, operationId }) => {
            const catalog = await promptCatalog(connection, signal);
            assert(
              catalog.generation === input.generation,
              'MCP_CATALOG_CHANGED',
              '提示词目录已变化，请重新选择。',
            );
            const entry = catalog.entries.find((e) => e.name === input.name);
            assert(entry, 'MCP_PROMPT_UNAVAILABLE', '提示词不在已选择的目录中。');
            validatePromptArguments(entry, input.arguments);
            await authorize();
            scope.record('mcp/dispatch', {
              operationId,
              serverId: input.serverId,
              configRevision: catalog.configRevision,
              name: input.name,
              argumentsHash: fingerprint(input.arguments),
            });
            const response = await connection.interact((continuation) =>
              connection.client.getPrompt(
                { name: input.name, arguments: input.arguments, ...continuation },
                {
                  signal,
                  allowInputRequired: true,
                  timeout: 60000,
                  maxTotalTimeout: 60000,
                  resetTimeoutOnProgress: false,
                },
              ),
            );
            signal.throwIfAborted();
            const value = promptPreview(response, { ...input, binding: catalog.binding });
            return this.store.transaction(() => {
              const previewId = scope.artifact('mcp-prompt-preview', JSON.stringify(value));
              scope.record('mcp/prompt-preview', {
                operationId,
                previewId,
                serverId: input.serverId,
                name: input.name,
                contentHash: value.contentHash,
              });
              return { ...value, previewId };
            });
          },
          { capability: 'prompts', metadataOnly: false },
        ),
      this.sensitiveValues,
    );
  }
  async apply(raw: McpPromptApply) {
    this.ensureOpen();
    const input = mcpPromptApplySchema.parse(raw);
    const session = this.store.get(input.sessionId, this.owner);
    assert(session.kind === 'agent', 'MODE_UNAVAILABLE', 'ChatBot 不连接 MCP。');
    const artifact = this.store.readArtifact(session.id, input.previewId);
    assert(artifact.kind === 'mcp-prompt-preview', 'MCP_PREVIEW_INVALID', '此产物不是提示词预览。');
    const preview = storedPreviewSchema.parse(JSON.parse(artifact.content));
    assert(
      preview.sessionId === session.id &&
        preview.contentHash === input.contentHash &&
        fingerprint(preview.text) === input.contentHash,
      'MCP_PREVIEW_INVALID',
      '预览内容与确认摘要不一致。',
    );
    const config = (await this.configs.file.read()).value.find((c) => c.id === preview.serverId);
    this.ensureOpen();
    return this.store.transaction(() => {
      let fresh = false;
      const receipt = this.submit(
        {
          sessionId: session.id,
          requestId: input.requestId,
          mode: input.mode,
          text: preview.text,
          ...(input.expectedTurnId ? { expectedTurnId: input.expectedTurnId } : {}),
        },
        () => {
          assert(
            config?.enabled &&
              config.capabilities.prompts &&
              config.revision === preview.configRevision,
            'MCP_CONFIG_CHANGED',
            '预览后服务器配置已变化，请重新获取预览。',
          );
          assert(Date.now() < preview.expiresAt, 'MCP_PREVIEW_EXPIRED', '预览已过期，请重新获取。');
          fresh = true;
        },
      );
      if (fresh)
        this.store.append(
          session.id,
          'mcp/prompt-applied',
          { ...input, serverId: preview.serverId, inputId: receipt.inputId },
          'user',
        );
      return receipt;
    });
  }
}

import type { ToolCall, ToolDefinition, ToolResult } from '@praxis/contracts';
import { assert } from '@praxis/contracts';
import type { Approve } from '@praxis/permissions';
import type { ActivePlugin } from '@praxis/plugin-host';
import { compileSchema } from '@praxis/schema';
import { SessionStore } from '@praxis/storage-local';
import { z } from 'zod';
import { descriptions, ids } from './definitions.ts';
import { executeFilesTool } from './files-tools.ts';
import { WorkspaceFiles } from './files.ts';
import { delegatedServices, invokePlugin } from './invoke-plugin.ts';
import { readPlan } from './plan.ts';
import { checkPluginPolicies } from './plugin-policy.ts';
import { executeProcessesTool } from './processes-tools.ts';
import { schemas } from './schemas.ts';
import { executeSessionTool } from './session-tools.ts';
import { recordToolFailure } from './tool-failure.ts';
import type { Ask, ProcessService, ToolExtension } from './types.ts';

export class ToolExecutor {
  private readonly coreDefinitions: ToolDefinition[];
  private extensionDefinitions = new Map<string, ToolDefinition>();
  private lifetime = new AbortController();
  private pending = new Set<Promise<unknown>>();
  private closing: Promise<void> | undefined;
  get definitions() {
    return [...this.coreDefinitions, ...this.extensionDefinitions.values()];
  }
  constructor(
    private sessionId: string,
    private store: SessionStore,
    readonly files: WorkspaceFiles,
    private ask: Ask,
    readonly processes?: ProcessService,
    readonly plugins: readonly ActivePlugin[] = [],
    readonly approve?: Approve,
    private consumeDelegatedTool?: () => void,
    private extension?: ToolExtension,
    private beforeCore?: (
      name: string,
      parameters: Record<string, unknown>,
      writing: boolean,
    ) => Promise<void>,
  ) {
    this.coreDefinitions = (Object.keys(schemas) as Array<keyof typeof schemas>).map((name) => ({
      id: ids[name],
      modelName: name,
      description: descriptions[name],
      parameters: z.toJSONSchema(schemas[name], { io: 'input' }),
    }));
    for (const plugin of plugins)
      for (const [name, tool] of plugin.tools)
        this.coreDefinitions.push({
          id: `${plugin.manifest.id}:${name}`,
          modelName: name,
          description: tool.description,
          parameters: tool.parameters,
        });
  }
  boundary() {
    const next = new Map<string, ToolDefinition>();
    const core = new Set(this.coreDefinitions.map((d) => d.modelName));
    for (const definition of this.extension?.boundary() ?? []) {
      assert(
        !core.has(definition.modelName) && !next.has(definition.modelName),
        'TOOL_NAME_CONFLICT',
        '扩展工具名称重复。',
      );
      next.set(definition.modelName, definition);
    }
    this.extensionDefinitions = next;
  }
  execute(call: ToolCall, callId: string, signal: AbortSignal): Promise<ToolResult> {
    return this.track(this.run(call, callId, AbortSignal.any([signal, this.lifetime.signal])));
  }
  private track<T>(operation: Promise<T>): Promise<T> {
    this.pending.add(operation);
    void operation.then(
      () => this.pending.delete(operation),
      () => this.pending.delete(operation),
    );
    return operation;
  }
  private async run(call: ToolCall, callId: string, signal: AbortSignal): Promise<ToolResult> {
    const started = performance.now();
    let effect = false;
    const result: ToolResult = {
      callId,
      toolId: call.name,
      toolVersion: 1,
      status: 'succeeded',
      effectState: 'none',
      artifactIds: [],
      truncated: false,
      durationMs: 0,
    };
    try {
      signal.throwIfAborted();
      const { plugin, extension, name, raw, writing } = await this.prepare(call, result, signal);
      if (extension) {
        await this.extension!.execute(call.name, raw, signal, result);
        result.durationMs = Math.round(performance.now() - started);
        return result;
      }
      if (plugin) {
        result.toolId = `${plugin.manifest.id}:${call.name}`;
        effect = true;
        result.data = await invokePlugin(
          plugin,
          call,
          raw,
          this.delegate(plugin.manifest.id, callId, signal),
        );
        result.effectState = 'unknown';
        result.durationMs = Math.round(performance.now() - started);
        return result;
      }
      schemas[name].parse(raw);
      const permission = this.store.get(this.sessionId).permission;
      assert(!writing || !this.processes?.active, 'WORKSPACE_BUSY', '活动命令占用工作区修改位置。');
      assert(
        !writing || permission.mode === 'workspace-write',
        'ACCESS_DENIED',
        '会话当前是只读模式。',
      );
      effect = writing;
      if (name.startsWith('fs_')) await executeFilesTool(this.files, name, raw, signal, result);
      else if (name.startsWith('process_'))
        await executeProcessesTool(this.processes, permission, name, raw, signal, result);
      else
        await executeSessionTool(this.store, this.sessionId, this.ask, name, raw, signal, result);
      const diff = (result.data as { diffArtifactId?: string } | undefined)?.diffArtifactId;
      if (diff) result.artifactIds.push(diff);
    } catch (error) {
      recordToolFailure(result, error, signal.aborted, effect);
    }
    result.durationMs = Math.round(performance.now() - started);
    return result;
  }
  private async prepare(call: ToolCall, result: ToolResult, signal: AbortSignal) {
    const plugin = this.plugins.find((p) => p.tools.has(call.name));
    const extension = this.extensionDefinitions.get(call.name);
    assert(
      Object.hasOwn(schemas, call.name) || plugin || extension,
      'TOOL_NOT_AVAILABLE',
      '此工具未注册。',
    );
    assert(
      Buffer.byteLength(call.arguments) <= 2 * 1024 * 1024,
      'INVALID_ARGUMENT',
      '工具参数超限。',
    );
    const name = call.name as keyof typeof schemas;
    result.toolId = extension?.id ?? (plugin ? `${plugin.manifest.id}:${call.name}` : ids[name]);
    const raw: unknown = JSON.parse(call.arguments);
    if (plugin) compileSchema(plugin.tools.get(call.name)!.parameters).validate(raw);
    if (extension) compileSchema(extension.parameters).validate(raw);
    const writing = ['fs_write', 'fs_apply_patch', 'process_exec'].includes(name);
    if (!plugin && !extension) {
      const parsed = schemas[name].parse(raw);
      assert(
        !writing || this.store.get(this.sessionId).permission.mode === 'workspace-write',
        'ACCESS_DENIED',
        '会话当前是只读模式。',
      );
      if (name === 'process_exec')
        assert(this.processes, 'SANDBOX_UNAVAILABLE', '此平台命令隔离尚未通过验证。');
      if ('path' in parsed) await this.files.resolve(parsed.path, writing);
    }
    await this.enforcePluginPolicy(call, result, raw, signal);
    if (!plugin && !extension) await this.beforeCore?.(name, schemas[name].parse(raw), writing);
    signal.throwIfAborted();
    return { plugin, extension, name, raw, writing };
  }
  private async enforcePluginPolicy(
    call: ToolCall,
    result: ToolResult,
    raw: unknown,
    signal: AbortSignal,
  ) {
    const reasons = await checkPluginPolicies(this.plugins, call, raw, signal);
    signal.throwIfAborted();
    if (reasons.length) {
      assert(this.approve, 'APPROVAL_UNAVAILABLE', '当前调用没有审批通道。');
      const grant = await this.approve(
        {
          callId: result.callId,
          toolId: result.toolId,
          parameters: raw,
          reason: `以下插件要求额外审批：${reasons.join('、')}`,
          resources: { workspace: this.files.root },
        },
        signal,
      );
      grant();
    }
  }
  project(result: ToolResult): string {
    const full = JSON.stringify(result);
    if (Buffer.byteLength(full) <= 16 * 1024) return full;
    const artifactId = this.store.artifact(this.sessionId, 'tool-output', full);
    return JSON.stringify({
      ...result,
      data: { preview: full.slice(0, 3000), note: '输出已截断，使用 artifact_read 读取完整产物。' },
      artifactIds: [...result.artifactIds, artifactId],
      truncated: true,
    });
  }
  plan() {
    return readPlan(this.store, this.sessionId);
  }
  delegate(pluginId: string, callId: string, signal: AbortSignal) {
    const services = delegatedServices(
      pluginId,
      callId,
      AbortSignal.any([signal, this.lifetime.signal]),
      this.sessionId,
      this.store,
      this.execute.bind(this),
      this.consumeDelegatedTool,
    );
    return {
      ...services,
      invokeCore: (name: string, args: Record<string, unknown>) =>
        this.track(services.invokeCore(name, args)),
    };
  }
  close(): Promise<void> {
    return (this.closing ??= this.drain());
  }
  private async drain() {
    this.lifetime.abort();
    const closed = await Promise.allSettled([this.extension?.close(), this.processes?.close()]);
    await Promise.allSettled([...this.pending]);
    for (const result of closed) if (result.status === 'rejected') throw result.reason;
  }
}

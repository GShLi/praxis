import { z } from 'zod';
import { assert, PraxisError, safeError } from '../../contracts/src/index.ts';
import type {
  Permission,
  ToolCall,
  ToolDefinition,
  ToolResult,
} from '../../contracts/src/index.ts';
import { SessionStore, uuid } from '../../storage-local/src/index.ts';
import type { ActivePlugin } from '../../plugin-host/src/index.ts';
import { WorkspaceFiles } from './files.ts';

const shortText = z.string().min(1).max(4096);
const scan = {
  path: z.string().max(4096).default('.'),
  includeHidden: z.boolean().default(false),
  respectIgnore: z.boolean().default(true),
};
const planItem = z.strictObject({
  id: shortText,
  title: shortText,
  status: z.enum(['pending', 'in_progress', 'completed', 'blocked', 'cancelled']),
});
const question = z.strictObject({
  id: shortText,
  prompt: shortText,
  options: z
    .array(
      z.strictObject({
        id: shortText,
        label: shortText,
        description: z.string().max(4096).optional(),
      }),
    )
    .min(2)
    .max(10)
    .optional(),
});
const baseCommand = {
  cwd: z.string().max(4096).default('.'),
  description: shortText,
  timeoutMs: z.number().int().min(1).max(1_800_000).default(120_000),
  yieldMs: z.number().int().min(0).max(10_000).default(1000),
  env: z.record(z.string(), z.string()).default({}),
};
export const schemas = {
  fs_list: z.strictObject({
    path: z.string().max(4096).default('.'),
    includeHidden: z.boolean().default(false),
    limit: z.number().int().min(1).max(500).default(100),
    cursor: shortText.optional(),
  }),
  fs_find: z.strictObject({
    ...scan,
    pattern: shortText,
    limit: z.number().int().min(1).max(1000).default(200),
  }),
  fs_search: z.strictObject({
    ...scan,
    query: shortText,
    syntax: z.enum(['literal', 'regex']).default('literal'),
    include: z.array(shortText).max(50).default([]),
    caseSensitive: z.boolean().default(true),
    contextLines: z.number().int().min(0).max(5).default(0),
    limit: z.number().int().min(1).max(500).default(100),
  }),
  fs_read: z.strictObject({
    path: shortText,
    startLine: z.number().int().min(1).default(1),
    lineCount: z.number().int().min(1).max(2000).default(200),
  }),
  fs_write: z.discriminatedUnion('mode', [
    z.strictObject({
      path: shortText,
      mode: z.literal('create'),
      content: z.string(),
      createParents: z.boolean().default(false),
    }),
    z.strictObject({
      path: shortText,
      mode: z.literal('replace'),
      content: z.string(),
      expectedVersion: shortText,
    }),
  ]),
  fs_apply_patch: z.strictObject({
    path: shortText,
    expectedVersion: shortText,
    edits: z
      .array(
        z.strictObject({
          oldText: z.string().min(1),
          newText: z.string(),
          expectedMatches: z.number().int().min(1).max(10000),
        }),
      )
      .min(1)
      .max(50),
  }),
  process_exec: z.discriminatedUnion('kind', [
    z.strictObject({
      ...baseCommand,
      kind: z.literal('exec'),
      executable: shortText,
      args: z.array(z.string().max(32_768)).max(256),
    }),
    z.strictObject({
      ...baseCommand,
      kind: z.literal('shell'),
      shell: z.enum(['bash', 'pwsh']),
      script: z.string().min(1).max(64_000),
    }),
  ]),
  process_read: z.strictObject({
    executionId: shortText,
    cursor: z.string().max(256).optional(),
    waitMs: z.number().int().min(0).max(10_000).default(0),
    maxBytes: z.number().int().min(1).max(65536).default(16384),
  }),
  process_list: z.strictObject({
    includeFinished: z.boolean().default(false),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  process_cancel: z.strictObject({
    executionId: shortText,
    reason: z.string().max(4096).optional(),
  }),
  task_update_plan: z.strictObject({
    expectedRevision: z.number().int().nonnegative(),
    items: z.array(planItem).max(100),
    explanation: z.string().max(8192).optional(),
  }),
  user_ask: z.strictObject({ questions: z.array(question).min(1).max(3) }),
  artifact_read: z.strictObject({
    artifactId: shortText,
    cursor: z.string().max(256).optional(),
    maxBytes: z.number().int().min(1).max(65536).default(16384),
  }),
};
const descriptions: Record<keyof typeof schemas, string> = {
  fs_list: '列出工作区目录。隐藏和敏感路径受 Host 策略限制。',
  fs_find: '按相对 glob 查找文件，递归使用 **。',
  fs_search: '有界文本搜索；当前支持字面量语法。',
  fs_read: '读取带版本的 UTF-8 文本行。修改前必须先读取完整修改范围。',
  fs_write: '排他创建新文件，或使用先前完整读取的版本替换文件。',
  fs_apply_patch: '对同一文件版本进行精确、不重叠的文本替换。',
  process_exec: '在已验证的操作系统沙箱内运行命令。不可用时拒绝执行。',
  process_read: '读取本会话命令状态和有界输出；查询成功不等于命令成功。',
  process_list: '列出本会话的受管命令。',
  process_cancel: '终止本会话受管命令树，不回滚已发生的文件变化。',
  task_update_plan: '提交完整、版本化任务计划；最多一项进行中。',
  user_ask: '向实际用户询问需求；回答不代表执行审批，不要询问密钥。',
  artifact_read: '使用 Host 产物 ID 读取文本，不接受任意文件路径。',
};
const ids: Record<keyof typeof schemas, string> = {
  fs_list: 'fs.list',
  fs_find: 'fs.find',
  fs_search: 'fs.search',
  fs_read: 'fs.read',
  fs_write: 'fs.write',
  fs_apply_patch: 'fs.apply_patch',
  process_exec: 'process.exec',
  process_read: 'process.read',
  process_list: 'process.list',
  process_cancel: 'process.cancel',
  task_update_plan: 'task.update_plan',
  user_ask: 'user.ask',
  artifact_read: 'artifact.read',
};
export interface ProcessService {
  active: boolean;
  execute(
    input: z.infer<typeof schemas.process_exec>,
    signal: AbortSignal,
    permission: Permission,
  ): Promise<unknown>;
  read(input: z.infer<typeof schemas.process_read>, signal: AbortSignal): Promise<unknown>;
  list(input: z.infer<typeof schemas.process_list>): unknown;
  cancel(input: z.infer<typeof schemas.process_cancel>): Promise<unknown>;
  close(): Promise<void>;
}
export type Ask = (
  questions: z.infer<typeof schemas.user_ask>['questions'],
  signal: AbortSignal,
) => Promise<unknown>;
export class ToolExecutor {
  readonly definitions: ToolDefinition[];
  constructor(
    private sessionId: string,
    private store: SessionStore,
    readonly files: WorkspaceFiles,
    private ask: Ask,
    readonly processes?: ProcessService,
    readonly plugins: readonly ActivePlugin[] = [],
  ) {
    this.definitions = (Object.keys(schemas) as Array<keyof typeof schemas>).map((name) => ({
      id: ids[name],
      modelName: name,
      description: descriptions[name],
      parameters: z.toJSONSchema(schemas[name], { io: 'input' }),
    }));
    for (const plugin of plugins)
      for (const [name, tool] of plugin.tools)
        this.definitions.push({
          id: `${plugin.manifest.id}:${name}`,
          modelName: name,
          description: tool.description,
          parameters: tool.parameters,
        });
  }
  async execute(call: ToolCall, callId: string, signal: AbortSignal): Promise<ToolResult> {
    const started = performance.now();
    let effect = false;
    const result: ToolResult = {
      callId,
      toolId: '',
      toolVersion: 1,
      status: 'succeeded',
      effectState: 'none',
      artifactIds: [],
      truncated: false,
      durationMs: 0,
    };
    try {
      signal.throwIfAborted();
      const plugin = this.plugins.find((p) => p.tools.has(call.name));
      assert(Object.hasOwn(schemas, call.name) || plugin, 'TOOL_NOT_AVAILABLE', '此工具未注册。');
      assert(
        Buffer.byteLength(call.arguments) <= 2 * 1024 * 1024,
        'INVALID_ARGUMENT',
        '工具参数超限。',
      );
      const name = call.name as keyof typeof schemas;
      result.toolId = ids[name];
      const raw: unknown = JSON.parse(call.arguments);
      for (const current of this.plugins)
        for (const check of current.checks) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const verdict = await Promise.race([
              check(call.name, structuredClone(raw)),
              new Promise<never>((_, reject) => {
                timer = setTimeout(
                  () => reject(new PraxisError('PLUGIN_TIMEOUT', '插件策略检查超时。')),
                  2000,
                );
              }),
            ]);
            assert(
              ['deny', 'ask', 'pass'].includes(verdict),
              'PLUGIN_INVALID',
              '插件策略结果无效。',
            );
            assert(verdict !== 'deny', 'ACCESS_DENIED', '插件策略拒绝此操作。');
            assert(
              verdict !== 'ask',
              'APPROVAL_REQUIRED',
              '插件要求额外授权；当前调用未获得授权。',
            );
          } finally {
            clearTimeout(timer);
          }
        }
      signal.throwIfAborted();
      if (plugin) {
        result.toolId = `${plugin.manifest.id}:${call.name}`;
        effect = true;
        result.data = await plugin.tools.get(call.name)!.execute(raw, {
          signal,
          invokeCore: async (name, args) => {
            assert(
              Object.hasOwn(schemas, name),
              'TOOL_NOT_AVAILABLE',
              '插件只能通过此服务调用核心工具。',
            );
            const delegatedId = uuid();
            this.store.append(this.sessionId, 'plugin/tool-intent', {
              pluginId: plugin.manifest.id,
              parentCallId: callId,
              delegatedId,
              name,
            });
            const value = await this.execute(
              { id: delegatedId, name, arguments: JSON.stringify(args) },
              delegatedId,
              signal,
            );
            this.store.append(
              this.sessionId,
              'plugin/tool-result',
              { pluginId: plugin.manifest.id, parentCallId: callId, result: value },
              'tool',
            );
            return value;
          },
        });
        result.effectState = 'unknown';
        result.durationMs = Math.round(performance.now() - started);
        return result;
      }
      schemas[name].parse(raw);
      const permission = this.store.get(this.sessionId).permission;
      const writing = ['fs_write', 'fs_apply_patch', 'process_exec'].includes(name);
      assert(!writing || !this.processes?.active, 'WORKSPACE_BUSY', '活动命令占用工作区修改位置。');
      assert(
        !writing || permission.mode === 'workspace-write',
        'ACCESS_DENIED',
        '会话当前是只读模式。',
      );
      effect = writing;
      switch (name) {
        case 'fs_list':
          result.data = await this.files.list(schemas.fs_list.parse(raw));
          break;
        case 'fs_find':
          result.data = await this.files.find(schemas.fs_find.parse(raw), signal);
          break;
        case 'fs_search':
          result.data = await this.files.search(schemas.fs_search.parse(raw), signal);
          break;
        case 'fs_read':
          result.data = await this.files.read(schemas.fs_read.parse(raw));
          break;
        case 'fs_write':
          result.data = await this.files.write(schemas.fs_write.parse(raw), signal);
          result.effectState = 'committed';
          break;
        case 'fs_apply_patch':
          result.data = await this.files.patch(schemas.fs_apply_patch.parse(raw), signal);
          result.effectState = 'committed';
          break;
        case 'process_exec':
          assert(this.processes, 'SANDBOX_UNAVAILABLE', '此平台命令隔离尚未通过验证。');
          result.data = await this.processes.execute(
            schemas.process_exec.parse(raw),
            signal,
            permission,
          );
          result.effectState = 'unknown';
          {
            const state = (result.data as { processState: string }).processState;
            result.status =
              state === 'running' ? 'running' : state === 'succeeded' ? 'succeeded' : 'failed';
          }
          break;
        case 'process_read':
          assert(this.processes, 'EXECUTION_NOT_FOUND', '此会话没有命令。');
          result.data = await this.processes.read(schemas.process_read.parse(raw), signal);
          break;
        case 'process_list':
          result.data = this.processes?.list(schemas.process_list.parse(raw)) ?? [];
          break;
        case 'process_cancel':
          assert(this.processes, 'EXECUTION_NOT_FOUND', '此会话没有命令。');
          result.data = await this.processes.cancel(schemas.process_cancel.parse(raw));
          break;
        case 'task_update_plan': {
          const input = schemas.task_update_plan.parse(raw);
          const plan = this.plan();
          assert(
            input.expectedRevision === plan.revision,
            'PLAN_VERSION_CONFLICT',
            '计划版本已变化。',
          );
          assert(
            new Set(input.items.map((i) => i.id)).size === input.items.length &&
              input.items.filter((i) => i.status === 'in_progress').length <= 1,
            'INVALID_ARGUMENT',
            '计划 ID 必须唯一，最多一项进行中。',
          );
          result.data = { revision: plan.revision + 1, items: input.items };
          this.store.append(
            this.sessionId,
            'plan/updated',
            result.data as Record<string, unknown>,
            'tool',
          );
          result.effectState = 'committed';
          break;
        }
        case 'user_ask': {
          const input = schemas.user_ask.parse(raw);
          assert(
            new Set(input.questions.map((q) => q.id)).size === input.questions.length,
            'INVALID_ARGUMENT',
            '题目 ID 必须唯一。',
          );
          result.data = await this.ask(input.questions, signal);
          break;
        }
        case 'artifact_read': {
          const input = schemas.artifact_read.parse(raw);
          const artifact = this.store.readArtifact(this.sessionId, input.artifactId);
          const bytes = Buffer.from(artifact.content);
          const offset = input.cursor ? Number(input.cursor) : 0;
          assert(
            Number.isSafeInteger(offset) &&
              offset >= 0 &&
              offset <= bytes.length &&
              (offset === bytes.length || (bytes[offset]! & 0xc0) !== 0x80),
            'CURSOR_EXPIRED',
            '产物游标无效。',
          );
          let end = Math.min(bytes.length, offset + Math.min(input.maxBytes, 12 * 1024));
          while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
          assert(
            end > offset || offset === bytes.length,
            'INVALID_ARGUMENT',
            '读取长度不足一个 UTF-8 字符。',
          );
          result.data = {
            ...artifact,
            content: bytes.subarray(offset, end).toString('utf8'),
            nextCursor: String(end),
            eof: end === bytes.length,
          };
          break;
        }
      }
      const diff = (result.data as { diffArtifactId?: string } | undefined)?.diffArtifactId;
      if (diff) result.artifactIds.push(diff);
    } catch (error) {
      const safe =
        error instanceof SyntaxError
          ? { code: 'INVALID_ARGUMENT', safeMessage: '工具参数 JSON 无效。' }
          : safeError(error);
      result.status = signal.aborted
        ? 'cancelled'
        : ['ACCESS_DENIED', 'APPROVAL_REJECTED'].includes(safe.code)
          ? 'denied'
          : 'failed';
      result.error = { code: safe.code, message: safe.safeMessage };
      // Unknown errors after dispatch may follow a write; never claim a rollback.
      if (
        effect &&
        ![
          'FILE_NOT_OBSERVED',
          'FILE_VERSION_CONFLICT',
          'FILE_ALREADY_EXISTS',
          'PATCH_OVERLAP',
          'PATCH_MATCH_COUNT_MISMATCH',
          'SANDBOX_UNAVAILABLE',
          'ACCESS_DENIED',
          'INVALID_ARGUMENT',
          'FILE_TOO_LARGE',
        ].includes(safe.code)
      )
        result.effectState = 'unknown';
    }
    result.durationMs = Math.round(performance.now() - started);
    return result;
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
  plan(): { revision: number; items: z.infer<typeof planItem>[] } {
    let after = 0;
    let plan: { revision: number; items: z.infer<typeof planItem>[] } = { revision: 0, items: [] };
    for (;;) {
      const events = this.store.events(this.sessionId, after);
      if (!events.length) break;
      for (const event of events)
        if (event.type === 'plan/updated') plan = event.payload as typeof plan;
      after = events.at(-1)!.seq;
    }
    return plan;
  }
  async close() {
    await this.processes?.close();
  }
}

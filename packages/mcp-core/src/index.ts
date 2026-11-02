import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { ConfigFile, fingerprint } from '../../config/src/index.ts';
import { assert, safeError } from '../../contracts/src/index.ts';
import type { ToolDefinition } from '../../contracts/src/index.ts';
import { compileSchema } from '../../schema/src/index.ts';
import type { JsonSchema } from '../../schema/src/index.ts';

const text = z.string().min(1).max(4096);
export const mcpConfigSchema = z.strictObject({
  id: z.uuid(),
  namespace: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
  displayName: text,
  revision: z.number().int().positive(),
  enabled: z.boolean(),
  protocol: z.enum(['auto', '2026-07-28', '2025-11-25']),
  transport: z.discriminatedUnion('type', [
    z.strictObject({
      type: z.literal('stdio'),
      executable: text,
      args: z.array(z.string().max(32768)).max(128),
      cwd: text,
      executableHash: z.string().regex(/^[a-f0-9]{64}$/),
      environment: z.record(z.string(), z.string()).default({}),
      secretEnvironment: z.record(z.string(), text).default({}),
    }),
    z.strictObject({
      type: z.literal('streamable-http'),
      endpoint: z.url().max(4096),
      allowPrivateDestination: z.boolean().default(false),
      auth: z.discriminatedUnion('type', [
        z.strictObject({ type: z.literal('none') }),
        z.strictObject({ type: z.literal('bearer'), credentialRef: text }),
        z.strictObject({ type: z.literal('oauth'), credentialRef: text, registrationRef: text }),
      ]),
    }),
  ]),
  capabilities: z.strictObject({
    tools: z.boolean(),
    resources: z.boolean(),
    prompts: z.boolean(),
  }),
});
export type McpConfig = z.infer<typeof mcpConfigSchema>;
export function validateConfig(raw: unknown): McpConfig {
  const config = mcpConfigSchema.parse(raw),
    transport = config.transport;
  if (transport.type === 'stdio') {
    assert(
      path.isAbsolute(transport.executable) && path.isAbsolute(transport.cwd),
      'MCP_CONFIG_INVALID',
      'stdio 需要固定的绝对程序路径和工作目录。',
    );
    assert(
      !/^(npx|npm|pnpm|yarn|bash|sh|cmd|powershell|pwsh)(?:\.exe)?$/i.test(
        path.basename(transport.executable),
      ),
      'MCP_CONFIG_INVALID',
      '请选择已安装的服务入口，不使用包管理器或 Shell 自动启动。',
    );
    const forbidden =
      /(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|^PRAXIS_|^NODE_OPTIONS$|^LD_|^DYLD_|^SSH_|^DOCKER_|^HOME$|^PATH$)/i;
    assert(
      !Object.keys(transport.environment).some((name) => forbidden.test(name)),
      'MCP_SECRET_REQUIRED',
      '秘密或进程注入变量不能写入普通环境配置。',
    );
    assert(
      !Object.keys(transport.secretEnvironment).some((name) =>
        /^(PRAXIS_|NODE_OPTIONS$|LD_|DYLD_|SSH_|HOME$|PATH$)/i.test(name),
      ),
      'MCP_CONFIG_INVALID',
      '不能通过秘密引用覆盖 Host 或启动环境。',
    );
  } else {
    const url = new URL(transport.endpoint);
    assert(
      !url.username && !url.password && !url.hash && !url.search,
      'MCP_ENDPOINT_INVALID',
      '端点不能包含身份、查询密钥或 fragment。',
    );
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    assert(
      url.protocol === 'https:' ||
        (url.protocol === 'http:' && loopback && transport.allowPrivateDestination),
      'MCP_ENDPOINT_INVALID',
      'MCP 端点要求 HTTPS；本机 HTTP 必须明确配置例外。',
    );
  }
  return config;
}
/** Profile and owner scope come from the Host directory, never from imported JSON. */
export class McpConfigService {
  readonly file: ConfigFile<McpConfig[]>;
  constructor(
    directory: string,
    private invalidate: (serverId: string) => void,
  ) {
    this.file = new ConfigFile(
      path.join(directory, 'mcp.json'),
      (raw) => z.array(z.unknown()).max(8).parse(raw).map(validateConfig),
      [],
    );
  }
  async upsert(raw: unknown, expectedStoreRevision: number, expectedRevision: number | null) {
    const config = validateConfig(raw);
    const result = await this.file.update(expectedStoreRevision, (configs) => {
      const old = configs.find((value) => value.id === config.id);
      assert(
        old
          ? old.revision === expectedRevision && old.namespace === config.namespace
          : expectedRevision === null,
        'CONFIG_CONFLICT',
        '服务器版本或固定命名空间不匹配。',
      );
      assert(
        !configs.some((value) => value.id !== config.id && value.namespace === config.namespace),
        'MCP_NAMESPACE_CONFLICT',
        'MCP 命名空间已被占用。',
      );
      // An edit is a new draft. Connection/operation consent is never inherited from a changed config.
      return [
        ...configs.filter((value) => value.id !== config.id),
        { ...config, revision: (old?.revision ?? 0) + 1, enabled: false },
      ];
    });
    this.invalidate(config.id);
    return result;
  }
  async disable(serverId: string, expectedStoreRevision: number) {
    const result = await this.file.update(expectedStoreRevision, (configs) => {
      assert(
        configs.some((value) => value.id === serverId),
        'MCP_NOT_FOUND',
        '服务器不存在。',
      );
      return configs.map((value) =>
        value.id === serverId ? { ...value, enabled: false, revision: value.revision + 1 } : value,
      );
    });
    this.invalidate(serverId);
    return result;
  }
}

export interface CatalogBinding {
  owner: string;
  client: string;
  serverId: string;
  configRevision: number;
  authEpoch: number;
}
export interface CatalogTool extends ToolDefinition {
  rawName: string;
  inputHash: string;
  outputSchema?: JsonSchema;
  headerPaths: Array<{ name: string; path: string[] }>;
  validate(input: unknown): void;
}
export interface Catalog {
  binding: CatalogBinding;
  generation: string;
  protocol: '2026-07-28' | '2025-11-25';
  instructions: string;
  tools: CatalogTool[];
  rejected: Array<{ name: string; code: string }>;
  fetchedAt: number;
  stale: boolean;
}
export type MetadataRpc = (
  method: string,
  params: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<unknown>;
export const modelToolName = (serverId: string, namespace: string, rawName: string) => {
  const safe = (value: string, max: number) =>
    value.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, max) || 'tool';
  return `mcp__${safe(namespace, 12)}__${safe(rawName, 32)}_${fingerprint([serverId, rawName]).slice(0, 12)}`;
};
export function encodeHeader(value: string | number | boolean) {
  const text = String(value);
  return !/^[\x20-\x7e]*$/.test(text) ||
    text.trim() !== text ||
    (text.startsWith('=?base64?') && text.endsWith('?='))
    ? `=?base64?${Buffer.from(text).toString('base64')}?=`
    : text;
}
export function prepareSchema(raw: unknown) {
  const paths: CatalogTool['headerPaths'] = [],
    names = new Set<string>();
  const visit = (value: unknown, parts: string[] | null, depth: number): unknown => {
    assert(depth < 24, 'MCP_SCHEMA_UNSUPPORTED', 'Schema 嵌套超限。');
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((entry) => visit(entry, null, depth + 1));
    const schema = value as JsonSchema,
      copy: JsonSchema = Object.create(null) as JsonSchema;
    for (const [key, entry] of Object.entries(schema)) {
      if (key === 'x-mcp-header') {
        assert(
          parts &&
            parts.length &&
            typeof entry === 'string' &&
            /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(entry) &&
            !names.has(entry.toLowerCase()) &&
            ['integer', 'string', 'boolean'].includes(String(schema.type)),
          'MCP_SCHEMA_UNSUPPORTED',
          '参数镜像 Header 注解无效。',
        );
        names.add(entry.toLowerCase());
        paths.push({ name: `Mcp-Param-${entry}`, path: parts });
      } else if (
        key === 'properties' &&
        entry &&
        typeof entry === 'object' &&
        !Array.isArray(entry)
      ) {
        copy[key] = Object.fromEntries(
          Object.entries(entry).map(([name, child]) => [
            name,
            visit(child, parts ? [...parts, name] : null, depth + 1),
          ]),
        );
      } else if (
        [
          'items',
          'additionalProperties',
          'anyOf',
          'allOf',
          'oneOf',
          '$defs',
          'definitions',
        ].includes(key)
      )
        copy[key] = visit(entry, null, depth + 1);
      else copy[key] = entry;
    }
    return copy;
  };
  const compiled = compileSchema(visit(raw, [], 0));
  assert(
    compiled.schema.type === 'object',
    'MCP_SCHEMA_UNSUPPORTED',
    'MCP 工具参数根必须是 object。',
  );
  return { ...compiled, headerPaths: paths };
}
export function argumentHeaders(tool: CatalogTool, input: unknown) {
  tool.validate(input);
  const headers: Record<string, string> = {};
  for (const item of tool.headerPaths) {
    let value = input;
    for (const part of item.path) {
      value =
        value && typeof value === 'object' && Object.hasOwn(value, part)
          ? (value as Record<string, unknown>)[part]
          : undefined;
    }
    if (value === undefined || value === null) continue;
    assert(
      ['string', 'boolean', 'number'].includes(typeof value) &&
        (typeof value !== 'number' || Number.isSafeInteger(value)),
      'MCP_RESPONSE_INVALID',
      'Header 参数不是支持的原始值。',
    );
    headers[item.name] = encodeHeader(value as string | number | boolean);
  }
  return headers;
}

export class McpCatalog {
  private current: Catalog | undefined;
  snapshot() {
    return this.current;
  }
  invalidate() {
    if (this.current) this.current.stale = true;
  }
  async refresh(
    binding: CatalogBinding,
    namespace: string,
    protocol: Catalog['protocol'],
    instructions: string,
    rpc: MetadataRpc,
    signal: AbortSignal,
  ) {
    assert(Buffer.byteLength(instructions) <= 8192, 'MCP_CATALOG_LIMIT', '服务器说明超过 8 KiB。');
    const tools: CatalogTool[] = [],
      rejected: Catalog['rejected'] = [],
      seen = new Set<string>(),
      cursors = new Set<string>(),
      modelNames = new Set<string>();
    let cursor: string | undefined,
      bytes = Buffer.byteLength(instructions),
      count = 0;
    try {
      for (let page = 0; page < 20; page++) {
        signal.throwIfAborted();
        const raw = await rpc('tools/list', cursor ? { cursor } : {}, signal);
        bytes += Buffer.byteLength(JSON.stringify(raw));
        assert(bytes <= 8 * 1024 * 1024, 'MCP_CATALOG_LIMIT', '目录超过 8 MiB。');
        const response = z
          .object({
            tools: z.array(z.object({ name: text }).passthrough()),
            nextCursor: z.string().min(1).max(4096).optional(),
          })
          .parse(raw);
        for (const entry of response.tools) {
          assert(!seen.has(entry.name), 'MCP_CATALOG_INVALID', '服务器返回了重复工具名。');
          seen.add(entry.name);
          assert(++count <= 200, 'MCP_CATALOG_LIMIT', '服务器工具超过 200 项。');
          try {
            assert(
              !entry.execution ||
                (entry.execution as { taskSupport?: string }).taskSupport !== 'required',
              'MCP_CAPABILITY_UNSUPPORTED',
              '此工具要求后台 Tasks。',
            );
            const schema = prepareSchema(entry.inputSchema),
              name = modelToolName(binding.serverId, namespace, entry.name);
            assert(!modelNames.has(name), 'MCP_NAME_COLLISION', '模型工具名摘要碰撞。');
            modelNames.add(name);
            const description = z
              .string()
              .max(16384)
              .parse(entry.description ?? '');
            const outputSchema =
              entry.outputSchema === undefined
                ? undefined
                : compileSchema(entry.outputSchema).schema;
            tools.push({
              id: JSON.stringify([binding.serverId, entry.name]),
              rawName: entry.name,
              modelName: name,
              description,
              parameters: schema.schema,
              inputHash: fingerprint(entry.inputSchema),
              headerPaths: schema.headerPaths,
              validate: schema.validate,
              ...(outputSchema ? { outputSchema } : {}),
            });
          } catch (error) {
            const code = safeError(error).code;
            if (code === 'MCP_NAME_COLLISION') throw error;
            rejected.push({ name: entry.name, code });
          }
        }
        cursor = response.nextCursor;
        if (!cursor) break;
        assert(
          !cursors.has(cursor) && page < 19,
          'MCP_CATALOG_INVALID',
          '目录游标循环或页数超限。',
        );
        cursors.add(cursor);
      }
      signal.throwIfAborted();
      const generation = fingerprint({
        binding,
        protocol,
        instructions,
        tools: tools.map(({ validate: _validate, ...tool }) => tool),
        rejected,
      });
      this.current = {
        binding: structuredClone(binding),
        generation,
        protocol,
        instructions,
        tools,
        rejected,
        fetchedAt: Date.now(),
        stale: false,
      };
      return this.current;
    } catch (error) {
      this.invalidate();
      throw error;
    }
  }
}
export class ToolSelector {
  private selected = new Map<string, CatalogTool>();
  private pending = new Map<string, CatalogTool>();
  private generations = new Map<string, string>();
  constructor(
    private tokenBudget: number,
    private maxTools = 32,
  ) {}
  discover(catalog: Catalog, query = '', limit = 5) {
    assert(
      !catalog.stale && limit >= 1 && limit <= 8,
      'MCP_CATALOG_STALE',
      '目录失效或发现数量无效。',
    );
    const old = this.generations.get(catalog.binding.serverId);
    assert(
      !old || old === catalog.generation,
      'MCP_CATALOG_CHANGED',
      '本轮固定目录已变化，请开始新任务轮次。',
    );
    this.generations.set(catalog.binding.serverId, catalog.generation);
    const found = catalog.tools
      .filter((tool) =>
        `${tool.rawName} ${tool.description}`.toLowerCase().includes(query.toLowerCase()),
      )
      .slice(0, limit);
    for (const tool of found) this.pending.set(tool.modelName, tool);
    return found.map(({ modelName, description, id }) => ({
      modelName,
      description,
      id,
      available: 'next-step',
    }));
  }
  boundary() {
    const excluded: string[] = [];
    for (const [name, tool] of this.pending) {
      const candidate = new Map(this.selected);
      candidate.set(name, tool);
      const bytes = Buffer.byteLength(
        JSON.stringify([...candidate.values()].map(({ validate: _validate, ...item }) => item)),
      );
      if (candidate.size > this.maxTools || Math.ceil(bytes / 2) > Math.min(4000, this.tokenBudget))
        excluded.push(name);
      else this.selected = candidate;
    }
    this.pending.clear();
    return { tools: [...this.selected.values()], excluded };
  }
  resolve(name: string) {
    const tool = this.selected.get(name);
    assert(tool, 'TOOL_NOT_AVAILABLE', '该工具尚未出现在当前步骤的工具快照。');
    return tool;
  }
}
export class ScopedReferences<T> {
  private values = new Map<string, { scope: string; value: T; expires: number }>();
  issue(scope: CatalogBinding & { generation: string }, value: T) {
    for (const [key, record] of this.values)
      if (record.expires < Date.now()) this.values.delete(key);
    assert(this.values.size < 1000, 'MCP_REFERENCE_LIMIT', '资源引用数量超限。');
    const id = randomUUID();
    this.values.set(id, {
      scope: fingerprint(scope),
      value: structuredClone(value),
      expires: Date.now() + 30 * 60_000,
    });
    return id;
  }
  read(scope: CatalogBinding & { generation: string }, id: string) {
    const record = this.values.get(id);
    assert(
      record && record.scope === fingerprint(scope) && record.expires >= Date.now(),
      'MCP_REFERENCE_EXPIRED',
      '引用已过期或不属于当前服务器/用户/目录。',
    );
    return structuredClone(record.value);
  }
}
export function normalizeResult(raw: unknown, outputSchema?: JsonSchema) {
  assert(
    Buffer.byteLength(JSON.stringify(raw) ?? '') <= 2 * 1024 * 1024,
    'MCP_RESULT_LIMIT',
    '结果超过 2 MiB。',
  );
  const result = z
    .object({
      content: z.array(z.object({ type: z.string() }).passthrough()).max(1000),
      structuredContent: z.record(z.string(), z.unknown()).optional(),
      isError: z.boolean().optional(),
    })
    .parse(raw);
  if (outputSchema && !result.isError)
    compileSchema(outputSchema).validate(result.structuredContent);
  const unsupportedContent: string[] = [];
  const content = result.content.map((block) => {
    if (block.type === 'text') return { type: 'text', text: z.string().parse(block.text) };
    if (block.type === 'resource_link')
      return { type: 'resource_link', uri: text.parse(block.uri), name: text.parse(block.name) };
    if (
      block.type === 'resource' &&
      block.resource &&
      typeof block.resource === 'object' &&
      'text' in block.resource
    ) {
      const item = z.object({ uri: text, text: z.string() }).parse(block.resource);
      return { type: 'resource', resource: item };
    }
    unsupportedContent.push(block.type);
    return { type: block.type, unsupported: true };
  });
  return {
    status: result.isError ? 'failed' : 'succeeded',
    effectState: 'unknown',
    content,
    ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
    unsupportedContent,
  };
}

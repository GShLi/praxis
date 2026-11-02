import {
  Client,
  StreamableHTTPClientTransport,
  SdkError,
  SdkErrorCode,
  UnauthorizedError,
  InsufficientScopeError,
  UnsupportedProtocolVersionError,
} from '@modelcontextprotocol/client';
import type { FetchLike, Transport, jsonSchemaValidator } from '@modelcontextprotocol/client';
import { assert, PraxisError } from '../../contracts/src/index.ts';
import { compileSchema } from '../../schema/src/index.ts';
import { McpCatalog, validateConfig } from '../../mcp-core/src/index.ts';
import type { CatalogBinding, McpConfig } from '../../mcp-core/src/index.ts';
import { controlledHttp } from './http.ts';

const validator: jsonSchemaValidator = {
  getValidator<T>(schema: Record<string, unknown>) {
    const compiled = compileSchema(schema);
    return (input: unknown) => {
      try {
        compiled.validate(input);
        return { valid: true as const, data: input as T, errorMessage: undefined };
      } catch {
        return {
          valid: false as const,
          data: undefined,
          errorMessage: 'MCP output schema validation failed',
        };
      }
    };
  },
};
export function mcpError(error: unknown, signal?: AbortSignal): PraxisError {
  if (error instanceof PraxisError) return error;
  if (signal?.aborted)
    return new PraxisError(
      signal.reason?.name === 'TimeoutError' ? 'MCP_OPERATION_TIMEOUT' : 'MCP_CANCELLED',
      'MCP 操作已超时或取消。',
    );
  if (error instanceof UnauthorizedError || error instanceof InsufficientScopeError)
    return new PraxisError('MCP_AUTH_REQUIRED', '服务器需要认证或更多权限；未自动认证或重试。');
  if (error instanceof UnsupportedProtocolVersionError)
    return new PraxisError('MCP_PROTOCOL_UNSUPPORTED', '服务器协议与 Praxis 支持的版本不兼容。');
  if (error instanceof SdkError && error.code === SdkErrorCode.RequestTimeout)
    return new PraxisError('MCP_OPERATION_TIMEOUT', 'MCP 请求超时。');
  return new PraxisError('MCP_PROTOCOL_FAILED', 'MCP 协议请求失败；未自动重放业务请求。');
}
/** One logical operation owns its SDK, transport and all ephemeral protocol state. */
export class McpConnection {
  readonly client: Client;
  private closed = false;
  private signal: AbortSignal;
  private lifetime = new AbortController();
  private closeTransport: (() => void) | undefined;
  constructor(
    readonly config: McpConfig,
    readonly binding: CatalogBinding,
    signal: AbortSignal,
  ) {
    validateConfig(config);
    assert(
      config.id === binding.serverId && config.revision === binding.configRevision,
      'MCP_CONFIG_CHANGED',
      'MCP 连接与配置版本不匹配。',
    );
    this.signal = AbortSignal.any([signal, this.lifetime.signal]);
    this.client = new Client(
      { name: 'Praxis', version: '0.1.0' },
      {
        supportedProtocolVersions: ['2026-07-28', '2025-11-25'],
        versionNegotiation: {
          mode:
            config.protocol === 'auto'
              ? 'auto'
              : config.protocol === '2025-11-25'
                ? 'legacy'
                : { pin: config.protocol },
          probe: { timeoutMs: 10_000, maxRetries: 0 },
        },
        capabilities: {},
        enforceStrictCapabilities: true,
        inputRequired: { autoFulfill: false, maxRounds: 8 },
        listMaxPages: 20,
        defaultCacheTtlMs: 0,
        cachePartition: JSON.stringify(binding),
        jsonSchemaValidator: validator,
      },
    );
    // Raw remote error messages can contain secrets; only stable local errors leave this adapter.
    this.client.onerror = () => {};
  }
  async connect(options: { transport?: Transport; fetch?: FetchLike; bearer?: string } = {}) {
    this.signal.throwIfAborted();
    assert(!this.closed, 'MCP_CONNECTION_CLOSED', 'MCP 连接已关闭。');
    let transport = options.transport;
    if (!transport) {
      const config = this.config.transport;
      assert(
        config.type === 'streamable-http',
        'MCP_SANDBOX_UNAVAILABLE',
        'stdio 需要已验证的原生沙箱启动器。',
      );
      assert(
        config.auth.type === 'none' || options.bearer,
        'MCP_AUTH_REQUIRED',
        '此连接需要本地 MCP 凭据。',
      );
      assert(
        !options.bearer || (/^[\x21-\x7e]+$/.test(options.bearer) && options.bearer.length <= 8192),
        'MCP_CREDENTIAL_INVALID',
        '凭据格式无效。',
      );
      const http = controlledHttp(this.config, this.signal);
      this.closeTransport = http.close;
      const fetch = options.fetch ?? http.fetch;
      transport = new StreamableHTTPClientTransport(new URL(config.endpoint), {
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            signal: AbortSignal.any([this.signal, ...(init?.signal ? [init.signal] : [])]),
          }),
        requestInit: { redirect: 'error' },
        redirectPolicy: 'follow', // The supplied fetch rejects redirects outright.
        reconnectionOptions: {
          maxRetries: 0,
          initialReconnectionDelay: 0,
          maxReconnectionDelay: 0,
          reconnectionDelayGrowFactor: 1,
        },
        reconnectionScheduler: () => {},
        onInsufficientScope: 'throw',
        maxStepUpRetries: 0,
        ...(options.bearer ? { authProvider: { token: async () => options.bearer } } : {}),
      });
    }
    try {
      await this.client.connect(transport, {
        signal: this.signal,
        timeout: 20_000,
        maxTotalTimeout: 20_000,
      });
      const protocol = this.client.getNegotiatedProtocolVersion();
      assert(
        protocol === '2026-07-28' || protocol === '2025-11-25',
        'MCP_PROTOCOL_UNSUPPORTED',
        '服务器返回了不支持的协议版本。',
      );
    } catch (error) {
      const failure = mcpError(error, this.signal);
      await this.close();
      throw failure;
    }
  }
  async catalog() {
    const protocol = this.client.getNegotiatedProtocolVersion();
    assert(
      protocol === '2026-07-28' || protocol === '2025-11-25',
      'MCP_NOT_CONNECTED',
      'MCP 尚未连接。',
    );
    const capabilities = this.client.getServerCapabilities();
    const catalog = new McpCatalog();
    try {
      return await catalog.refresh(
        this.binding,
        this.config.namespace,
        protocol,
        this.client.getInstructions() ?? '',
        async (_method, params, signal) => {
          if (!this.config.capabilities.tools || !capabilities?.tools) return { tools: [] };
          return this.client.request(
            { method: 'tools/list', params },
            { signal, timeout: 10_000, maxTotalTimeout: 10_000, resetTimeoutOnProgress: false },
          );
        },
        this.signal,
      );
    } catch (error) {
      throw mcpError(error, this.signal);
    }
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.lifetime.abort();
    this.closeTransport?.();
    await this.client.close().catch(() => {});
  }
}

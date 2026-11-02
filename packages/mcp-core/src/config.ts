import { assert } from '@praxis/contracts';
import path from 'node:path';
import { z } from 'zod';

export const text = z.string().min(1).max(4096);

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

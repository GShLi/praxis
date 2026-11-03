import { fingerprint } from '@praxis/config';
import { assert } from '@praxis/contracts';
import type { McpConfig } from '@praxis/mcp-core';
import { z } from 'zod';
const reference = z.tuple([
  z.enum(['os', 'memory']),
  z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  z.uuid(),
]);
export function credentialReference(config: McpConfig) {
  assert(
    config.transport.type === 'streamable-http' && config.transport.auth.type !== 'none',
    'MCP_AUTH_REQUIRED',
    '此服务器没有凭据引用。',
  );
  const parsed = reference.safeParse(config.transport.auth.credentialRef.split(':'));
  assert(parsed.success, 'MCP_AUTH_REQUIRED', '请在当前客户端重新设置此服务器的凭据。');
  const [storage, epoch, id] = parsed.data;
  return { storage, epoch, id };
}
export function credentialKey(
  config: McpConfig,
  owner: string,
  client: string,
  referenceId: string,
) {
  assert(
    config.transport.type === 'streamable-http',
    'MCP_AUTH_UNSUPPORTED',
    '此凭据仅用于固定 HTTP 端点。',
  );
  return fingerprint({
    owner,
    client,
    serverId: config.id,
    endpoint: new URL(config.transport.endpoint).href,
    referenceId,
  });
}

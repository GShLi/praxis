import {
  buildDiscoveryUrls,
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  validateClientMetadataUrl,
} from '@modelcontextprotocol/client';
import { assert, type McpOAuthStart } from '@praxis/contracts';
import { endpointUrl, OAuthNetwork } from './network.ts';
import { oauthMetadataSchema } from './schema.ts';

export async function discoverOAuth(
  resource: string,
  allowPrivateResource: boolean,
  input: McpOAuthStart,
  signal: AbortSignal,
) {
  const network = new OAuthNetwork(signal);
  const endpoint = endpointUrl(resource, allowPrivateResource);
  const path = endpoint.pathname.replace(/\/$/, '');
  for (const suffix of new Set([path, '']))
    network.allow(
      new URL(`/.well-known/oauth-protected-resource${suffix}`, endpoint),
      'GET',
      allowPrivateResource,
    );
  const protectedResource = await discoverOAuthProtectedResourceMetadata(
    endpoint,
    {},
    network.fetch,
  );
  assert(
    new URL(protectedResource.resource).href === endpoint.href &&
      protectedResource.authorization_servers?.includes(input.issuer),
    'MCP_OAUTH_BINDING',
    '所选授权服务器与 MCP 资源元数据不匹配。',
  );
  const issuer = endpointUrl(input.issuer, input.allowPrivateIssuer);
  for (const entry of buildDiscoveryUrls(input.issuer))
    network.allow(entry.url, 'GET', input.allowPrivateIssuer);
  const raw = await discoverAuthorizationServerMetadata(input.issuer, { fetchFn: network.fetch });
  const parsed = oauthMetadataSchema.safeParse(raw);
  assert(
    parsed.success && parsed.data.issuer === input.issuer,
    'MCP_OAUTH_METADATA',
    '授权服务器元数据无效。',
  );
  const metadata = parsed.data;
  assert(
    metadata.response_types_supported.includes('code') &&
      metadata.code_challenge_methods_supported.includes('S256') &&
      (!metadata.token_endpoint_auth_methods_supported ||
        metadata.token_endpoint_auth_methods_supported.includes('none')),
    'MCP_OAUTH_UNSUPPORTED',
    '授权服务器必须支持公共客户端、授权码和 PKCE S256。',
  );
  for (const url of [metadata.authorization_endpoint, metadata.token_endpoint])
    endpointUrl(url, input.allowPrivateIssuer && new URL(url).origin === issuer.origin);
  if (/^https?:/i.test(input.clientId)) {
    validateClientMetadataUrl(input.clientId);
    assert(
      metadata.client_id_metadata_document_supported,
      'MCP_OAUTH_CLIENT',
      '此服务器未声明支持 Client ID Metadata URL，请使用预注册的公共客户端 ID。',
    );
  }
  return metadata;
}

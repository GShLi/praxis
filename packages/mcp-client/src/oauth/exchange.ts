import { exchangeAuthorization } from '@modelcontextprotocol/client';
import type { McpOAuthStart } from '@praxis/contracts';
import type { AuthorizationReply } from './callback.ts';
import type { OAuthMetadata } from './schema.ts';
import { OAuthNetwork } from './network.ts';
import { applyTokens } from './tokens.ts';

export async function exchangeCode(
  input: McpOAuthStart,
  metadata: OAuthMetadata,
  resource: string,
  codeVerifier: string,
  reply: AuthorizationReply,
  signal: AbortSignal,
) {
  const network = new OAuthNetwork(signal);
  network.allow(
    metadata.token_endpoint,
    'POST',
    input.allowPrivateIssuer &&
      new URL(metadata.token_endpoint).origin === new URL(input.issuer).origin,
  );
  const tokens = await exchangeAuthorization(input.issuer, {
    metadata,
    clientInformation: { client_id: input.clientId },
    authorizationCode: reply.code,
    ...(reply.iss ? { iss: reply.iss } : {}),
    codeVerifier,
    redirectUri: input.redirectUri,
    resource: new URL(resource),
    fetchFn: network.fetch,
  });
  return applyTokens(
    {
      version: 1,
      issuer: input.issuer,
      resource,
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      scopes: input.scopes,
      allowPrivateIssuer: input.allowPrivateIssuer,
      metadata,
      authEpoch: Date.now(),
    },
    tokens,
  );
}

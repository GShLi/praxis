import type { OAuthTokens } from '@modelcontextprotocol/client';
import { assert } from '@praxis/contracts';
import { oauthAccountSchema, type OAuthAccount } from './schema.ts';

export function applyTokens(
  account: Omit<OAuthAccount, 'accessToken' | 'expiresAt' | 'state'>,
  tokens: OAuthTokens,
): OAuthAccount {
  assert(
    tokens.token_type.toLowerCase() === 'bearer',
    'MCP_OAUTH_TOKEN',
    '当前仅支持 Bearer OAuth Token。',
  );
  const granted =
    tokens.scope === undefined ? account.scopes : tokens.scope.split(' ').filter(Boolean);
  assert(
    granted.every((scope) => account.scopes.includes(scope)),
    'MCP_OAUTH_SCOPE',
    '授权返回了未确认的权限范围，请重新授权。',
  );
  assert(
    tokens.expires_in === undefined ||
      (Number.isFinite(tokens.expires_in) &&
        tokens.expires_in > 0 &&
        tokens.expires_in <= 31536000),
    'MCP_OAUTH_TOKEN',
    'OAuth Token 有效期无效。',
  );
  const parsed = oauthAccountSchema.safeParse({
    ...account,
    state: 'ready',
    scopes: [...new Set(granted)],
    accessToken: tokens.access_token,
    ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
    expiresAt: tokens.expires_in === undefined ? null : Date.now() + tokens.expires_in * 1000,
  });
  assert(parsed.success, 'MCP_OAUTH_TOKEN', 'OAuth Token 响应无效。');
  return parsed.data;
}

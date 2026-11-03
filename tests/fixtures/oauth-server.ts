import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

export async function oauthFixture() {
  let origin = '',
    refreshes = 0;
  const grants: URLSearchParams[] = [];
  const state: {
    expandScope: boolean;
    failRefresh: boolean;
    accessLifetime: number;
    beforeToken?: () => Promise<void>;
    issuerParameter: boolean;
    pkce: boolean;
    metadataTokenEndpoint?: string;
  } = {
    expandScope: false,
    failRefresh: false,
    accessLifetime: 3600,
    issuerParameter: false,
    pkce: true,
  };
  const server = createServer(async (req, res) => {
    const send = (value: unknown, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (req.url?.startsWith('/.well-known/oauth-protected-resource')) {
      send({
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
        scopes_supported: ['docs:read'],
      });
    } else if (req.url === '/.well-known/oauth-authorization-server') {
      send({
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: state.metadataTokenEndpoint ?? `${origin}/token`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: state.pkce ? ['S256'] : ['plain'],
        token_endpoint_auth_methods_supported: ['none'],
        authorization_response_iss_parameter_supported: state.issuerParameter,
      });
    } else if (req.url === '/token') {
      let body = '';
      for await (const chunk of req) body += String(chunk);
      const params = new URLSearchParams(body);
      grants.push(params);
      await state.beforeToken?.();
      if (params.get('grant_type') === 'refresh_token') refreshes++;
      if (state.failRefresh && params.get('grant_type') === 'refresh_token') {
        send({ error: 'invalid_grant', error_description: 'must never reach UI' }, 400);
      } else {
        send({
          access_token: `fixture-access-${refreshes}`,
          token_type: 'Bearer',
          expires_in: state.accessLifetime,
          refresh_token: `fixture-refresh-${refreshes}`,
          scope: state.expandScope ? 'docs:read admin' : 'docs:read',
        });
      }
    } else send({ error: 'not_found' }, 404);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    state,
    grants,
    refreshes: () => refreshes,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
    verifyPkce(url: URL) {
      const verifier = grants[0]?.get('code_verifier');
      assert(verifier);
      assert.equal(
        createHash('sha256').update(verifier).digest('base64url'),
        url.searchParams.get('code_challenge'),
      );
      assert.equal(grants[0]?.get('resource'), `${origin}/mcp`);
    },
  };
}

export async function unusedCallback() {
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const address = socket.address();
  assert(address && typeof address !== 'string');
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return `http://127.0.0.1:${address.port}/oauth/callback`;
}

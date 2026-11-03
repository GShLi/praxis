import { McpCredentials, SecretStore } from '@praxis/mcp-client/credentials';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { oauthProfile } from './fixtures/oauth-profile.ts';

test('OAuth rejects private discovery without consent, unknown issuer, non-PKCE and credential-shaped registration', async () => {
  const f = await oauthProfile();
  try {
    await assert.rejects(f.credentials.oauth.start({ ...f.input, allowPrivateIssuer: false }), {
      code: 'MCP_OAUTH_ENDPOINT',
    });
    await assert.rejects(
      f.credentials.oauth.start({ ...f.input, issuer: 'https://unlisted.invalid' }),
      { code: 'MCP_OAUTH_BINDING' },
    );
    await assert.rejects(
      f.credentials.oauth.start({ ...f.input, clientId: 'fixture-praxis-key' }),
      { code: 'MCP_SECRET_DENIED' },
    );
    f.remote.state.pkce = false;
    await assert.rejects(f.credentials.oauth.start(f.input), { code: 'MCP_OAUTH_UNSUPPORTED' });
    assert.equal(f.remote.grants.length, 0);
    assert.equal(f.values.size, 0);
  } finally {
    await f.close();
  }
});

test('OAuth cancellation, config changes and shutdown close the fixed callback without publishing credentials', async () => {
  const f = await oauthProfile();
  try {
    const started = await f.credentials.oauth.start(f.input);
    await assert.rejects(f.credentials.oauth.start(f.input), { code: 'MCP_OAUTH_BUSY' });
    assert.equal((await f.credentials.oauth.cancel(started.id)).status, 'cancelled');
    await assert.rejects(fetch(f.input.redirectUri));
    const next = await f.credentials.oauth.start(f.input);
    await f.configs.disable(f.config.id, 1);
    assert.equal((await f.credentials.oauth.wait(next.id)).status, 'cancelled');
    assert.equal(f.values.size, 0);
    const last = await f.credentials.oauth.start({
      ...f.input,
      expectedStoreRevision: 2,
      expectedRevision: 2,
    });
    assert.equal(f.credentials.oauth.status(last.id).status, 'waiting');
    await f.credentials.close();
    const port = Number(new URL(f.input.redirectUri).port),
      listener = createServer();
    await new Promise<void>((resolve, reject) => {
      listener.once('error', reject);
      listener.listen(port, '127.0.0.1', resolve);
    });
    await new Promise<void>((resolve) => listener.close(() => resolve()));
  } finally {
    await f.close();
  }
});

test('OAuth rejects mix-up callback issuers before exchange and refuses expanded scopes before persistence', async () => {
  const f = await oauthProfile();
  try {
    f.remote.state.issuerParameter = true;
    assert.equal((await f.authorize({ iss: 'https://attacker.invalid' })).status, 'failed');
    assert.equal(f.remote.grants.length, 0);
    f.remote.state.expandScope = true;
    const failed = await f.authorize({ iss: f.remote.origin });
    assert.equal(failed.error?.code, 'MCP_OAUTH_SCOPE');
    assert.equal(f.values.size, 0);
    assert.equal((await f.configs.file.read()).revision, 1);
  } finally {
    await f.close();
  }
});

test('an uncertain refresh is durably blocked across service restart and its error never includes remote descriptions', async () => {
  const f = await oauthProfile();
  try {
    f.remote.state.accessLifetime = 1;
    assert.equal((await f.authorize()).status, 'succeeded');
    const config = (await f.configs.file.read()).value[0]!;
    f.remote.state.failRefresh = true;
    await assert.rejects(
      f.credentials.resolve(config, AbortSignal.timeout(3000)),
      (error: Error) => {
        assert.ok(!error.message.includes('must never'));
        return true;
      },
    );
    await f.credentials.close();
    const restarted = new McpCredentials(f.configs, new SecretStore(f.backend), 'alice', 'cli');
    try {
      await assert.rejects(restarted.resolve(config, AbortSignal.timeout(3000)), {
        code: 'MCP_AUTH_REQUIRED',
      });
      assert.equal(f.remote.refreshes(), 1);
    } finally {
      await restarted.close();
    }
  } finally {
    await f.close();
  }
});

test('late concurrent callers join the same refresh and one cancellation does not cancel other callers', async () => {
  const f = await oauthProfile();
  let release = () => {};
  try {
    f.remote.state.accessLifetime = 1;
    await f.authorize();
    const config = (await f.configs.file.read()).value[0]!;
    let arrived = () => {};
    const ready = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.remote.state.beforeToken = async () => {
      arrived();
      await hold;
    };
    f.remote.state.accessLifetime = 3600;
    const first = new AbortController();
    const cancelled = assert.rejects(f.credentials.resolve(config, first.signal), {
      code: 'MCP_OAUTH_CANCELLED',
    });
    await ready;
    const remaining = f.credentials.resolve(config, AbortSignal.timeout(3000));
    first.abort();
    await cancelled;
    release();
    assert.equal((await remaining).bearer, 'fixture-access-1');
    assert.equal(f.remote.refreshes(), 1);
    assert.equal(f.epochs.length, 1);
  } finally {
    release();
    await f.close();
  }
});

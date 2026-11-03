import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('Linux disconnected Secret Service is an error for OS reads/deletes; new secrets may use memory', async () => {
  await disconnected(`
    import {NativeSecretBackend, SecretStore} from '@praxis/mcp-client/credentials';
    const store = new SecretStore(new NativeSecretBackend('auto'));
    const key = 'a'.repeat(64);
    try {
      await assert.rejects(store.get(key, 'os'), {code:'SECRET_STORE_UNAVAILABLE'});
      await assert.rejects(store.delete(key, 'os'), {code:'SECRET_STORE_UNAVAILABLE'});
      assert.equal(await store.put(key, 'disposable-secret'), 'memory');
      assert.equal(await store.get(key, 'memory'), 'disposable-secret');
      await store.delete(key, 'memory');
      assert.equal(await store.get(key, 'memory'), undefined);
    } finally { await store.close(); }
  `);
});

test('Linux service failure retains an OS credential reference when removing an MCP connection', async () => {
  await disconnected(`
    import {McpCredentials, NativeSecretBackend, SecretStore} from '@praxis/mcp-client/credentials';
    import {McpConfigService} from '@praxis/mcp-core';
    import {randomUUID} from 'node:crypto';
    const configs = new McpConfigService(process.env.HOME, () => {});
    const credentials = new McpCredentials(configs, new SecretStore(new NativeSecretBackend('auto')), 'fixture', 'cli');
    const id = randomUUID();
    const auth = {type:'bearer', credentialRef:'os:1:'+randomUUID()};
    try {
      await configs.upsert({
        id, namespace:'fixture', displayName:'Fixture', revision:1, enabled:false,
        protocol:'auto', capabilities:{tools:true, resources:false, prompts:false},
        transport:{type:'streamable-http', endpoint:'https://fixture.invalid/mcp', auth}
      }, 0, null);
      await assert.rejects(credentials.deleteConfig(id, 1, 1), {code:'SECRET_STORE_UNAVAILABLE'});
      const state = await configs.file.read();
      assert.equal(state.value.length, 1);
      assert.equal(state.value[0].enabled, false);
      assert.deepEqual(state.value[0].transport.auth, auth);
    } finally { await credentials.close(); }
  `);
});

async function disconnected(source: string) {
  assert.equal(process.platform, 'linux', 'Run this suite on native Linux with secret-tool.');
  await access('/usr/bin/secret-tool', constants.X_OK);
  const root = await mkdtemp(path.join(tmpdir(), 'praxis-secret-service-failure-'));
  try {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `import assert from 'node:assert/strict';\n${source}`,
      ],
      {
        // A nonexistent private bus path prevents access to any real credentials or unlock UI.
        env: { HOME: root, DBUS_SESSION_BUS_ADDRESS: `unix:path=${path.join(root, 'absent-bus')}` },
        encoding: 'utf8',
        timeout: 10000,
        killSignal: 'SIGKILL',
        maxBuffer: 65536,
      },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

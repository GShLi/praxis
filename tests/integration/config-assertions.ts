import type { EffectiveConfig, Permission } from '@praxis/contracts';
import { startHost } from '@praxis/client-host';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);

export async function checkEffectiveConfig(env: Record<string, string>) {
  const cli = (...args: string[]) =>
    execute(process.execPath, ['--import', 'tsx', 'apps/cli/src/main.ts', ...args], {
      env: { ...process.env, ...env },
      timeout: 20000,
    });
  const sessions: Array<{ id: string }> = JSON.parse((await cli('sessions')).stdout);
  const id = sessions[0]?.id;
  assert.ok(id);
  const result = JSON.parse((await cli('config', id)).stdout);
  assert.deepEqual(result.snapshot.values.workspace.ignore, ['generated/']);
  assert.deepEqual(result.snapshot.values.workspace.validationCommands, ['echo advisory only']);
  assert.equal(result.snapshot.values.provider, null);
  const host = await startHost('cli', env);
  try {
    await host.rpc.request('auth/bind', {
      serverUrl: env.PRAXIS_SERVER_URL,
      praxisApiKey: env.PRAXIS_API_KEY,
    });
    await host.rpc.request('session/set-permissions', {
      sessionId: id,
      expectedRevision: result.currentPermission.revision,
      permission: { ...result.currentPermission, mode: 'read-only' },
    });
    const current = await host.rpc.request<{
      snapshot: EffectiveConfig;
      currentPermission: Permission;
    }>('session/config', { sessionId: id });
    assert.equal(current.currentPermission.mode, 'read-only');
    assert.equal(current.snapshot.values.permission.mode, 'workspace-write');
    assert.equal(current.snapshot.hash, result.snapshot.hash);
    assert.ok(!JSON.stringify(current).includes(env.PRAXIS_API_KEY!));
    await assert.rejects(
      host.rpc.request('session/config', { sessionId: crypto.randomUUID() }),
      /会话不存在/,
    );
  } finally {
    await host.close();
  }
}

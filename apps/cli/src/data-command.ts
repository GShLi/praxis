import { AuthClient } from '@praxis/auth-client';
import { baseData } from '@praxis/config/paths';
import { bindLegacyProfile, profilePaths, resolveProfileDirectory } from '@praxis/config/profile';
import { assert } from '@praxis/contracts';
import { saveDiagnosticExport } from '@praxis/diagnostics';
import {
  BackupRestoreError,
  createLocalBackup,
  inspectLocalBackup,
  restoreLocalBackup,
  type BackupIdentity,
} from '@praxis/storage-local/backup';
import { acquireLease } from '@praxis/workspace';
import path from 'node:path';
import type { CliOptions } from './options.ts';

export async function dataCommand(values: CliOptions, positionals: string[]) {
  const request = parseDataRequest(values, positionals);
  const apiKey = process.env.PRAXIS_API_KEY;
  assert(apiKey, 'PRAXIS_KEY_REQUIRED', '请设置 PRAXIS_API_KEY 验证备份所属账号。');
  const scope = new AbortController(),
    stop = () => scope.abort();
  const auth = new AuthClient(
    values.server ?? process.env.PRAXIS_SERVER_URL ?? 'http://127.0.0.1:4310',
  );
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    await auth.bind(apiKey, scope.signal);
    await authenticatedDataAction(auth, request, values.confirm, scope);
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    await auth.clear();
  }
}

async function authenticatedDataAction(
  auth: AuthClient,
  { action, target, clientKind }: ReturnType<typeof parseDataRequest>,
  confirmation: string | undefined,
  scope: AbortController,
) {
  const profile = { userId: auth.userId, serverUrl: auth.origin, clientKind };
  const identity: BackupIdentity = { ownerUserId: auth.userId, serverUrl: auth.origin, clientKind };
  if (action === 'inspect') {
    assert(target, 'INVALID_COMMAND', '缺少备份目录。');
    const manifest = await inspectLocalBackup(path.resolve(target), identity, scope.signal);
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }
  const directory =
    action === 'bind-legacy'
      ? profilePaths(baseData, profile).legacy
      : await resolveProfileDirectory(baseData, profile);
  if (action === 'export-diagnostics') {
    assert(target, 'INVALID_COMMAND', '缺少诊断导出目录。');
    const report = await saveDiagnosticExport(
      path.join(directory, 'diagnostics'),
      path.resolve(target),
      scope.signal,
    );
    console.log(JSON.stringify(report));
    return;
  }
  const lease = await acquireLease(path.join(directory, 'writer.lock'));
  lease.onLost(() => scope.abort());
  try {
    scope.signal.throwIfAborted();
    if (action === 'bind-legacy') {
      assert(confirmation, 'PROFILE_CONFIRM_REQUIRED', '缺少旧数据的原服务地址确认。');
      console.log(
        JSON.stringify(
          await bindLegacyProfile(baseData, profile, confirmation, scope.signal),
          null,
          2,
        ),
      );
    } else {
      assert(target, 'INVALID_COMMAND', '缺少备份目录。');
      await executeDataAction(
        action,
        path.join(directory, 'sessions.sqlite'),
        path.resolve(target),
        identity,
        scope.signal,
        confirmation,
      );
    }
  } finally {
    await lease.release();
  }
}

async function executeDataAction(
  action: string,
  database: string,
  target: string,
  identity: BackupIdentity,
  signal: AbortSignal,
  confirmation?: string,
) {
  try {
    if (action === 'backup')
      console.log(
        JSON.stringify(await createLocalBackup(database, target, identity, signal), null, 2),
      );
    else {
      assert(confirmation, 'BACKUP_CONFIRM_REQUIRED', '缺少确认摘要。');
      console.log(
        JSON.stringify(
          await restoreLocalBackup(database, target, identity, signal, confirmation),
          null,
          2,
        ),
      );
      console.log('会话已恢复。重新打开客户端查看历史；任务不会自动继续。');
    }
  } catch (error) {
    if (error instanceof BackupRestoreError)
      console.error(JSON.stringify({ rollbackDirectory: error.rollbackDirectory }));
    throw error;
  }
}

function parseDataRequest(
  values: CliOptions,
  positionals: string[],
): { action: string; target: string | undefined; clientKind: BackupIdentity['clientKind'] } {
  const action = positionals[1],
    target = positionals[2];
  assert(
    action &&
      (action === 'bind-legacy' ||
        (['backup', 'inspect', 'restore', 'export-diagnostics'].includes(action) && target)),
    'INVALID_COMMAND',
    'data 支持 backup DIRECTORY / inspect BACKUP / restore BACKUP --confirm SHA256 / export-diagnostics DIRECTORY / bind-legacy --confirm 原服务地址。',
  );
  const clientKind = values.client ?? 'cli';
  assert(
    clientKind === 'cli' || clientKind === 'desktop',
    'INVALID_ARGUMENT',
    '--client 仅支持 cli 或 desktop。',
  );
  if (action === 'restore')
    assert(
      values.confirm && /^[a-f0-9]{64}$/.test(values.confirm),
      'BACKUP_CONFIRM_REQUIRED',
      '请先 data inspect 查看身份、数量和摘要，再用 --confirm SHA256 确认覆盖此客户端的全部会话。',
    );
  if (action === 'bind-legacy')
    assert(values.confirm, 'PROFILE_CONFIRM_REQUIRED', '请用 --confirm 原服务地址明确绑定旧数据。');
  return { action, target, clientKind };
}

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
const execute = promisify(execFile);

export async function checkWorkspaceBinding(
  workspace: string,
  providerId: string,
  env: Record<string, string>,
) {
  await mkdir(path.join(workspace, '.praxis'));
  await writeFile(
    path.join(workspace, '.praxis/config.json'),
    JSON.stringify({
      schemaVersion: 1,
      mcp: { servers: [{ serverId: crypto.randomUUID() }] },
    }),
  );
  await assert.rejects(
    execute(
      process.execPath,
      [
        '--import',
        'tsx',
        'apps/cli/src/main.ts',
        'run',
        '--workspace',
        workspace,
        '--provider',
        providerId,
        '--prompt',
        '外部模板 Create a hello page',
      ],
      { env: { ...process.env, ...env }, timeout: 20000, maxBuffer: 1024 * 1024 },
    ),
    /WORKSPACE_MCP_UNAVAILABLE/,
  );
}

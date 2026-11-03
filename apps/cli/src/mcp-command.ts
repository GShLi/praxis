import { configureMcpBearer, clearMcpCredential } from './mcp-auth.ts';
import type { CliOptions } from './options.ts';
import { mcpPromptCommand } from './mcp-prompts.ts';
import type { startHost } from '@praxis/client-host';
import { assert } from '@praxis/contracts';
import { open } from 'node:fs/promises';

async function importedConfig(file: string) {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(65537);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    assert(bytesRead <= 65536, 'CONFIG_LIMIT', 'MCP 配置文件不能超过 64 KiB。');
    const config: unknown = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
    assert(
      config && typeof config === 'object' && 'id' in config && typeof config.id === 'string',
      'INVALID_ARGUMENT',
      '需要包含 id 的完整 MCP 服务器配置。',
    );
    return config;
  } finally {
    await handle.close();
  }
}

export async function mcpCommand(
  host: Awaited<ReturnType<typeof startHost>>,
  positionals: string[],
  values: CliOptions,
  bearer?: string,
) {
  const action = positionals[1] ?? 'list',
    target = positionals[2];
  if (await mcpPromptCommand(host, positionals, values.arguments)) return;
  if (action === 'auth' || action === 'clear-auth') {
    assert(target, 'INVALID_ARGUMENT', '需要服务器 ID。');
    const result =
      action === 'auth'
        ? await configureMcpBearer(host, target, bearer)
        : await clearMcpCredential(host, target);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const state = await host.rpc.request<{
    revision: number;
    value: Array<{ id: string; revision: number }>;
  }>('mcp/server-list');
  let result: unknown;
  if (action === 'list') result = state;
  else if (action === 'import') {
    assert(target, 'INVALID_ARGUMENT', '需要配置 JSON 文件路径。');
    const config = await importedConfig(target);
    result = await host.rpc.request('mcp/server-upsert', {
      config,
      expectedStoreRevision: state.revision,
      expectedRevision: state.value.find((c) => c.id === config.id)?.revision ?? null,
    });
  } else {
    const config = state.value.find((c) => c.id === target);
    assert(config, 'MCP_NOT_FOUND', '需要已保存的服务器 ID。');
    assert(
      ['test', 'enable', 'disable'].includes(action),
      'INVALID_COMMAND',
      'mcp 支持 list / import FILE / test ID / enable ID / disable ID。',
    );
    if (action === 'disable')
      result = await host.rpc.request('mcp/server-disable', {
        serverId: config.id,
        expectedStoreRevision: state.revision,
      });
    else {
      result = await host.rpc.request('mcp/test', {
        serverId: config.id,
        expectedRevision: config.revision,
      });
      if (action === 'enable')
        result = await host.rpc.request('mcp/server-enable', {
          serverId: config.id,
          expectedStoreRevision: state.revision,
          expectedRevision: config.revision,
        });
    }
  }
  console.log(JSON.stringify(result, null, 2));
}

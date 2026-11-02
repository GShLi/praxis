import { startHost } from '@praxis/client-host';
import { assert } from '@praxis/contracts';
import type { CliOptions } from './options.ts';
export async function pluginCommand(
  host: Awaited<ReturnType<typeof startHost>>,
  values: CliOptions,
  positionals: string[],
) {
  const action = positionals[1] ?? 'list',
    source = positionals[2];
  const state = await host.rpc.request<{ revision: number }>('plugin/list');
  let result: unknown;
  if (action === 'list') result = state;
  else if (action === 'inspect') {
    assert(source, 'INVALID_ARGUMENT', '需要插件目录。');
    result = await host.rpc.request('plugin/inspect', { source });
  } else if (action === 'install') {
    assert(
      source && values.digest,
      'INVALID_ARGUMENT',
      '请先 inspect 检查来源与能力，再用 --digest 指定确认的摘要安装可信插件。',
    );
    result = await host.rpc.request('plugin/install', {
      source,
      expectedDigest: values.digest,
      expectedRevision: state.revision,
    });
  } else if (action === 'enable' || action === 'disable') {
    assert(source, 'INVALID_ARGUMENT', '需要插件 ID。');
    result = await host.rpc.request('plugin/set-enabled', {
      id: source,
      enabled: action === 'enable',
      expectedRevision: state.revision,
    });
  } else throw new Error('plugins 支持 list / inspect / install / enable / disable。');
  console.log(JSON.stringify(result, null, 2));
}

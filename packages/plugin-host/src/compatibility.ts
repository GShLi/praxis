import { assert } from '@praxis/contracts';
import type { InstalledPlugin } from './manifest.ts';

export function checkCompatibility(
  record: InstalledPlugin,
  mode: 'chat' | 'agent',
  runtime: 'local-host' | 'server',
) {
  assert(
    record.enabled &&
      record.manifest.platforms.includes(process.platform as 'darwin' | 'linux' | 'win32') &&
      record.manifest.runtimes.includes(runtime) &&
      record.manifest.modes.includes(mode),
    'PLUGIN_INCOMPATIBLE',
    '插件不支持当前系统、运行位置或模式。',
  );
  assert(
    runtime !== 'server' ||
      (mode === 'chat' && record.manifest.capabilities.every((c) => c === 'model-provider')),
    'PLUGIN_INCOMPATIBLE',
    '服务端模型注册表只加载部署者配置的纯模型适配器。',
  );
}

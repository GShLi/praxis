import { assert, type UserCommand } from '@praxis/contracts';
import { findPluginCommand, invokeUserCommand, type ActivePlugin } from '@praxis/plugin-host';
import type { SessionStore } from '@praxis/storage-local';
import type { Active } from './types.ts';

/** User-only operation: no model request and no command definitions exposed as model tools. */
export async function executeUserCommand(
  store: SessionStore,
  turn: Active,
  input: UserCommand,
  plugins: readonly ActivePlugin[],
) {
  const { plugin } = findPluginCommand(plugins, input);
  const identity = {
    pluginId: plugin.manifest.id,
    pluginVersion: plugin.manifest.version,
    pluginDigest: plugin.digest,
    name: input.name,
    turnId: turn.id,
    requestId: input.requestId,
  };
  store.append(
    input.sessionId,
    'plugin/command-started',
    { ...identity, arguments: input.arguments },
    'user',
  );
  const signal = turn.controller.signal;
  const result = await invokeUserCommand(plugins, input, signal, (operationSignal) => ({
    signal: operationSignal,
    invokeCore: async (name, args) => {
      assert(turn.executor, 'MODE_UNAVAILABLE', 'ChatBot 的插件命令不能执行 Agent 工具。');
      return turn.executor
        .delegate(plugin.manifest.id, turn.id, operationSignal)
        .invokeCore(name, args);
    },
  }));
  signal.throwIfAborted();
  let content: string | undefined;
  try {
    content = JSON.stringify(result);
  } catch {
    /* Invalid plugin values never enter storage. */
  }
  assert(content !== undefined, 'PLUGIN_COMMAND_RESULT_INVALID', '插件命令须返回可序列化 JSON。');
  assert(
    Buffer.byteLength(content) <= 2 * 1024 * 1024,
    'PLUGIN_COMMAND_RESULT_LIMIT',
    '插件命令结果超过 2 MiB。',
  );
  store.transaction(() => {
    const artifactId = store.artifact(input.sessionId, 'plugin-command-result', content);
    store.append(
      input.sessionId,
      'plugin/command-result',
      {
        ...identity,
        artifactId,
        preview: content.slice(0, 4000),
        truncated: content.length > 4000,
        effectState: 'unknown',
      },
      'tool',
    );
  });
}

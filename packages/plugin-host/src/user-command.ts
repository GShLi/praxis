import { assert, PraxisError, type UserCommand } from '@praxis/contracts';
import type { PluginServices } from '@praxis/plugin-sdk';
import { compileSchema } from '@praxis/schema';
import { hookOperation } from './hook-operation.ts';
import type { ActivePlugin } from './types.ts';

export function findPluginCommand(
  plugins: readonly ActivePlugin[],
  input: Pick<UserCommand, 'pluginId' | 'name' | 'arguments'>,
) {
  const plugin = plugins.find((p) => p.manifest.id === input.pluginId);
  const command = plugin?.commands.get(input.name);
  assert(plugin && command, 'PLUGIN_COMMAND_UNAVAILABLE', '插件命令未启用或不支持当前模式。');
  compileSchema(command.parameters).validate(input.arguments);
  return { plugin, command };
}

export async function invokeUserCommand(
  plugins: readonly ActivePlugin[],
  input: UserCommand,
  parent: AbortSignal,
  services: (signal: AbortSignal) => PluginServices,
) {
  const { command } = findPluginCommand(plugins, input);
  return hookOperation(
    async (signal) => {
      try {
        return await command.execute(input.arguments, services(signal));
      } catch {
        if (signal.aborted) throw signal.reason;
        throw new PraxisError('PLUGIN_COMMAND_FAILED', '插件命令执行失败，请查看工具记录。');
      }
    },
    parent,
    120_000,
  );
}

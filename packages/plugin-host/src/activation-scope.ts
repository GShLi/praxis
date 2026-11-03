import { assert } from '@praxis/contracts';
import type { ModelClient } from '@praxis/model-core';
import type { PluginCommand, PluginContext, PluginTool } from '@praxis/plugin-sdk';
import { compileSchema } from '@praxis/schema';
import type { InstalledPlugin, Manifest } from './manifest.ts';
import type { ActivePlugin } from './types.ts';
export function activationScope(
  record: InstalledPlugin,
  mode: 'chat' | 'agent',
  reservedTools: Set<string>,
  accepting: () => boolean,
  active: () => readonly ActivePlugin[],
) {
  let open = true;
  const cleanups: Array<() => void | Promise<void>> = [];
  const tools = new Map<string, PluginTool>(),
    providers = new Map<string, ModelClient>(),
    commands = new Map<string, PluginCommand>();
  const checks: ActivePlugin['checks'] = [],
    contributors: ActivePlugin['contributors'] = [],
    finished: ActivePlugin['finished'] = [];
  const capability = (name: Manifest['capabilities'][number]) =>
    assert(
      open && accepting() && record.manifest.capabilities.includes(name),
      'PLUGIN_CAPABILITY_DENIED',
      '插件未声明此能力或激活窗口已关闭。',
    );
  const unique = (
    name: string,
    table: Map<string, unknown>,
    existing: ReadonlyMap<string, unknown>[],
  ) =>
    assert(
      /^[a-z][a-z0-9_]{0,63}$/.test(name) &&
        !table.has(name) &&
        !existing.some((map) => map.has(name)),
      'PLUGIN_NAME_CONFLICT',
      '插件注册名称重复或不合法。',
    );
  const ctx: PluginContext = {
    pluginId: record.manifest.id,
    mode: mode,
    registerTool: (tool) => {
      capability('agent-tool');
      assert(
        mode === 'agent' && !reservedTools.has(tool.name),
        'PLUGIN_MODE_DENIED',
        'Chat 模式不接受工具，核心工具名不可覆盖。',
      );
      unique(
        tool.name,
        tools,
        active().map((p) => p.tools),
      );
      const schema = compileSchema(tool.parameters);
      tools.set(tool.name, {
        ...tool,
        parameters: schema.schema,
        execute: (input, services) => {
          schema.validate(input);
          return tool.execute(input, services);
        },
      });
    },
    registerProvider: (id, provider) => {
      capability('model-provider');
      unique(
        id,
        providers,
        active().map((p) => p.providers),
      );
      providers.set(id, provider);
    },
    registerCommand: (
      name,
      command,
      parameters = { type: 'object', additionalProperties: false },
    ) => {
      capability('user-command');
      unique(
        name,
        commands,
        active().map((p) => p.commands),
      );
      const schema = compileSchema(parameters);
      commands.set(name, {
        parameters: schema.schema,
        execute: (input, services) => {
          schema.validate(input);
          return command(input, services);
        },
      });
    },
    beforeExecute: (check) => {
      capability('policy-check');
      checks.push(check);
    },
    contributeContext: (contributor) => {
      capability('context-contributor');
      contributors.push(contributor);
    },
    onTurnFinished: (callback) => {
      capability('lifecycle');
      finished.push(callback);
    },
    onDispose: (cleanup) => {
      assert(open, 'PLUGIN_ACTIVATION_CLOSED', '激活窗口已关闭。');
      cleanups.push(cleanup);
    },
  };
  return {
    ctx,
    cleanups,
    tools,
    providers,
    commands,
    checks,
    contributors,
    finished,
    close: () => {
      open = false;
    },
  };
}

import { fingerprint } from '@praxis/config';
import { assert } from '@praxis/contracts';
import type { ModelClient } from '@praxis/model-core';
import type { PluginContext, PluginTool, PraxisPlugin } from '@praxis/plugin-sdk';
import { compileSchema } from '@praxis/schema';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { deadline } from './deadline.ts';
import { inspectPackage } from './inspect.ts';
import { PluginInstaller } from './installer.ts';
import type { InstalledPlugin, Manifest } from './manifest.ts';
import type { ActivePlugin } from './types.ts';

/** Trusted code contract, not a JavaScript sandbox. Registry publication is transactional. */
export class PluginHost {
  private active: ActivePlugin[] = [];
  private cleanups: Array<() => void | Promise<void>> = [];
  private accepting = true;
  constructor(
    private reservedTools: Set<string>,
    private mode: 'chat' | 'agent',
    private activateTimeoutMs = 10000,
  ) {}
  snapshot(): readonly ActivePlugin[] {
    return [...this.active];
  }
  async load(installer: PluginInstaller, record: InstalledPlugin) {
    assert(record.enabled && this.accepting, 'PLUGIN_DISABLED', '插件未启用或 Host 正在关闭。');
    const inspected = await inspectPackage(installer.path(record));
    assert(
      inspected.digest === record.digest &&
        fingerprint(inspected.manifest) === fingerprint(record.manifest),
      'PLUGIN_PACKAGE_CHANGED',
      '插件完整性校验失败。',
    );
    assert(
      record.manifest.platforms.includes(process.platform as 'darwin' | 'linux' | 'win32') &&
        record.manifest.runtimes.includes('local-host') &&
        record.manifest.modes.includes(this.mode),
      'PLUGIN_INCOMPATIBLE',
      '插件不支持当前系统、运行位置或模式。',
    );
    const module = (await import(
      pathToFileURL(path.join(installer.path(record), record.manifest.entry)).href
    )) as { default?: PraxisPlugin };
    assert(
      module.default && typeof module.default.activate === 'function',
      'PLUGIN_INVALID',
      '插件必须默认导出 activate。',
    );
    return this.activate(record, module.default);
  }
  async activate(record: InstalledPlugin, plugin: PraxisPlugin) {
    let open = true;
    const cleanups: Array<() => void | Promise<void>> = [];
    const tools = new Map<string, PluginTool>(),
      providers = new Map<string, ModelClient>(),
      commands = new Map<string, Parameters<PluginContext['registerCommand']>[1]>();
    const checks: ActivePlugin['checks'] = [],
      contributors: ActivePlugin['contributors'] = [],
      finished: ActivePlugin['finished'] = [];
    const capability = (name: Manifest['capabilities'][number]) =>
      assert(
        open && this.accepting && record.manifest.capabilities.includes(name),
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
      mode: this.mode,
      registerTool: (tool) => {
        capability('agent-tool');
        assert(
          this.mode === 'agent' && !this.reservedTools.has(tool.name),
          'PLUGIN_MODE_DENIED',
          'Chat 模式不接受工具，核心工具名不可覆盖。',
        );
        unique(
          tool.name,
          tools,
          this.active.map((p) => p.tools),
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
          this.active.map((p) => p.providers),
        );
        providers.set(id, provider);
      },
      registerCommand: (name, command) => {
        capability('user-command');
        unique(
          name,
          commands,
          this.active.map((p) => p.commands),
        );
        commands.set(name, command);
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
    try {
      await deadline(
        Promise.resolve().then(() => plugin.activate(Object.freeze(ctx))),
        this.activateTimeoutMs,
      );
      assert(
        this.accepting && !this.active.some((p) => p.manifest.id === record.manifest.id),
        'PLUGIN_NAME_CONFLICT',
        '插件已激活或 Host 正在关闭。',
      );
      for (const name of tools.keys())
        assert(
          !this.active.some((p) => p.tools.has(name)),
          'PLUGIN_NAME_CONFLICT',
          '工具名已被并发激活的插件占用。',
        );
      for (const name of providers.keys())
        assert(
          !this.active.some((p) => p.providers.has(name)),
          'PLUGIN_NAME_CONFLICT',
          'Provider 名重复。',
        );
      for (const name of commands.keys())
        assert(
          !this.active.some((p) => p.commands.has(name)),
          'PLUGIN_NAME_CONFLICT',
          '命令名重复。',
        );
      const active = {
        manifest: structuredClone(record.manifest),
        digest: record.digest,
        tools,
        providers,
        commands,
        checks,
        contributors,
        finished,
      };
      this.active.push(active);
      this.cleanups.push(...cleanups);
      return active;
    } catch (error) {
      open = false;
      await Promise.allSettled(
        cleanups.reverse().map((cleanup) => deadline(Promise.resolve().then(cleanup), 2000)),
      );
      throw error;
    } finally {
      open = false;
    }
  }
  async dispose() {
    this.accepting = false;
    await Promise.allSettled(
      this.cleanups.reverse().map((cleanup) => deadline(Promise.resolve().then(cleanup), 2000)),
    );
    this.cleanups = [];
    this.active = [];
  }
}

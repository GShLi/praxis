import { fingerprint } from '@praxis/config';
import { assert } from '@praxis/contracts';
import type { PraxisPlugin } from '@praxis/plugin-sdk';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { activationScope } from './activation-scope.ts';
import { deadline } from './deadline.ts';
import { inspectPackage } from './inspect.ts';
import { PluginInstaller } from './installer.ts';
import type { InstalledPlugin } from './manifest.ts';
import type { ActivePlugin } from './types.ts';
import { checkCompatibility } from './compatibility.ts';

/** Trusted code contract, not a JavaScript sandbox. Registry publication is transactional. */
export class PluginHost {
  private active: ActivePlugin[] = [];
  private cleanups: Array<() => void | Promise<void>> = [];
  private accepting = true;
  constructor(
    private reservedTools: Set<string>,
    private mode: 'chat' | 'agent',
    private activateTimeoutMs = 10000,
    private runtime: 'local-host' | 'server' = 'local-host',
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
    checkCompatibility(record, this.mode, this.runtime);
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
    checkCompatibility(record, this.mode, this.runtime);
    const scope = activationScope(
      record,
      this.mode,
      this.reservedTools,
      () => this.accepting,
      () => this.active,
    );
    const { ctx, cleanups, tools, providers, commands, checks, contributors, finished } = scope;
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
      for (const registry of ['tools', 'providers', 'commands'] as const)
        for (const name of scope[registry].keys())
          assert(
            !this.active.some((p) => p[registry].has(name)),
            'PLUGIN_NAME_CONFLICT',
            '注册名称已被并发激活的插件占用。',
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
      scope.close();
      await Promise.allSettled(
        cleanups.reverse().map((cleanup) => deadline(Promise.resolve().then(cleanup), 2000)),
      );
      throw error;
    } finally {
      scope.close();
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

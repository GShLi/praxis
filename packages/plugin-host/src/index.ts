import { mkdir, readdir, lstat, readFile, realpath, writeFile, rename, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { assert, PraxisError } from '../../contracts/src/index.ts';
import { ConfigFile, fingerprint } from '../../config/src/index.ts';
import { compileSchema } from '../../schema/src/index.ts';
import type { PluginContext, PluginTool, PraxisPlugin } from '../../plugin-sdk/src/index.ts';
import type { ModelClient } from '../../model-core/src/index.ts';

export const manifestSchema = z.strictObject({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/)
    .max(100),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  sdkVersion: z.literal('^1.0.0'),
  entry: z
    .string()
    .regex(/\.(?:mjs|js)$/)
    .max(512),
  runtimes: z.array(z.enum(['local-host', 'server'])).min(1),
  modes: z.array(z.enum(['chat', 'agent'])).min(1),
  capabilities: z.array(
    z.enum([
      'model-provider',
      'agent-tool',
      'user-command',
      'policy-check',
      'context-contributor',
      'lifecycle',
    ]),
  ),
  platforms: z.array(z.enum(['darwin', 'linux', 'win32'])).min(1),
});
export type Manifest = z.infer<typeof manifestSchema>;
const recordSchema = z.strictObject({
  manifest: manifestSchema,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  enabled: z.boolean(),
});
const recordsSchema = z.array(recordSchema).max(32);
export type InstalledPlugin = z.infer<typeof recordSchema>;

export async function inspectPackage(source: string) {
  const root = await realpath(source),
    files: Array<{ relative: string; content: Buffer }> = [];
  let size = 0;
  const visit = async (directory: string) => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name, 'en'),
    )) {
      const target = path.join(directory, entry.name),
        info = await lstat(target);
      assert(
        !info.isSymbolicLink() && (info.isFile() || info.isDirectory()),
        'PLUGIN_PACKAGE_INVALID',
        '插件包不能包含链接或特殊文件。',
      );
      assert(
        !['node_modules', '.git', '.env'].includes(entry.name) &&
          !/\.(exe|dll|dylib|so|node)$/i.test(entry.name),
        'PLUGIN_PACKAGE_INVALID',
        '插件须预先构建，不安装依赖或运行包内二进制。',
      );
      if (info.isDirectory()) {
        await visit(target);
        continue;
      }
      assert(
        info.nlink === 1 && info.size <= 8 * 1024 * 1024 && files.length < 512,
        'PLUGIN_PACKAGE_LIMIT',
        '插件文件或数量超限。',
      );
      const content = await readFile(target);
      size += content.length;
      assert(size <= 32 * 1024 * 1024, 'PLUGIN_PACKAGE_LIMIT', '插件包超过 32 MiB。');
      files.push({ relative: path.relative(root, target).split(path.sep).join('/'), content });
    }
  };
  await visit(root);
  const manifestFile = files.find((file) => file.relative === 'praxis-plugin.json');
  assert(manifestFile, 'PLUGIN_MANIFEST_MISSING', '缺少 praxis-plugin.json。');
  const manifest = manifestSchema.parse(JSON.parse(manifestFile.content.toString('utf8')));
  assert(
    !manifest.entry.includes('\\') &&
      !manifest.entry.split('/').some((p) => p === '..' || p === '') &&
      !path.isAbsolute(manifest.entry),
    'PLUGIN_ENTRY_INVALID',
    '插件入口必须位于包内。',
  );
  assert(
    files.some((file) => file.relative === manifest.entry),
    'PLUGIN_ENTRY_INVALID',
    '插件入口不存在。',
  );
  const digest = fingerprint(
    files.map((file) => [file.relative, createHash('sha256').update(file.content).digest('hex')]),
  );
  return { root, manifest, digest, bytes: size, files };
}
export class PluginInstaller {
  readonly records: ConfigFile<InstalledPlugin[]>;
  constructor(readonly directory: string) {
    this.records = new ConfigFile(
      path.join(directory, 'plugins.json'),
      (v) => recordsSchema.parse(v),
      [],
    );
  }
  path(record: InstalledPlugin) {
    return path.join(
      this.directory,
      'versions',
      record.manifest.id,
      record.manifest.version,
      record.digest,
    );
  }
  async inspect(source: string) {
    const { manifest, digest, bytes } = await inspectPackage(source);
    return {
      manifest,
      digest,
      bytes,
      warning: '可信插件可使用 Host 的完整代码权限。请只安装你信任的来源。',
    };
  }
  async install(source: string, expectedDigest: string, expectedRevision: number) {
    const inspected = await inspectPackage(source);
    assert(
      inspected.digest === expectedDigest,
      'PLUGIN_PACKAGE_CHANGED',
      '包内容已变化，请重新检查。',
    );
    const record: InstalledPlugin = {
      manifest: inspected.manifest,
      digest: inspected.digest,
      enabled: false,
    };
    const target = this.path(record),
      temporary = path.join(this.directory, 'staging', randomUUID());
    await mkdir(temporary, { recursive: true, mode: 0o700 });
    try {
      for (const file of inspected.files) {
        const output = path.join(temporary, file.relative);
        await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
        await writeFile(output, file.content, { flag: 'wx', mode: 0o600 });
      }
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      try {
        await rename(temporary, target);
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? ''))
          throw error;
        const existing = await inspectPackage(target);
        assert(
          existing.digest === expectedDigest,
          'PLUGIN_PACKAGE_CHANGED',
          '已安装的包完整性不匹配。',
        );
      }
      return await this.records.update(expectedRevision, (records) => [
        ...records.filter((r) => r.manifest.id !== record.manifest.id),
        record,
      ]);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
  setEnabled(id: string, enabled: boolean, expectedRevision: number) {
    return this.records.update(expectedRevision, (records) => {
      assert(
        records.some((r) => r.manifest.id === id),
        'PLUGIN_NOT_FOUND',
        '插件未安装。',
      );
      return records.map((r) => (r.manifest.id === id ? { ...r, enabled } : r));
    });
  }
}

export type ActivePlugin = {
  manifest: Manifest;
  digest: string;
  tools: ReadonlyMap<string, PluginTool>;
  providers: ReadonlyMap<string, ModelClient>;
  commands: ReadonlyMap<string, Parameters<PluginContext['registerCommand']>[1]>;
  checks: Array<Parameters<PluginContext['beforeExecute']>[0]>;
  contributors: Array<Parameters<PluginContext['contributeContext']>[0]>;
  finished: Array<Parameters<PluginContext['onTurnFinished']>[0]>;
};
async function deadline<T>(action: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      action,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new PraxisError('PLUGIN_TIMEOUT', '插件操作超过时间限制。')),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
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

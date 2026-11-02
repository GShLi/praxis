import { ConfigFile } from '@praxis/config';
import { assert } from '@praxis/contracts';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inspectPackage } from './inspect.ts';
import type { InstalledPlugin } from './manifest.ts';
import { recordsSchema } from './manifest.ts';

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

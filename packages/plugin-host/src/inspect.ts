import { fingerprint } from '@praxis/config';
import { assert } from '@praxis/contracts';
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { manifestSchema } from './manifest.ts';

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

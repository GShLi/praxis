import { assert } from '@praxis/contracts';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { NativeWorkspaceIo } from './native/io.ts';
export const protectedParts = new Set(['.git', '.hg', '.svn', '.ssh', '.aws', '.gnupg', '.praxis']);
export function sensitive(name: string) {
  return (
    protectedParts.has(name.toLowerCase()) ||
    /^\.env(?:\.|$)/i.test(name) ||
    /\.(?:pem|key|p12|pfx)$/i.test(name)
  );
}
export function isInside(root: string, target: string) {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}
export function absent(error: unknown) {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}
export class WorkspacePathPolicy {
  readonly io: NativeWorkspaceIo;
  constructor(
    readonly root: string,
    private protectedPaths: string[],
    rootIdentity: string,
  ) {
    this.io = new NativeWorkspaceIo(root, rootIdentity);
  }
  async resolve(input: string, writing = false): Promise<string> {
    assert(!input.includes('\0'), 'INVALID_ARGUMENT', '路径包含非法字符。');
    const target = path.resolve(this.root, input);
    assert(isInside(this.root, target), 'ACCESS_DENIED', '目标不在工作区内。');
    assert(
      !this.protectedPaths.some((p) => isInside(p, target)),
      'ACCESS_DENIED',
      '目标属于受保护的应用数据。',
    );
    const components = path.relative(this.root, target).split(path.sep).filter(Boolean);
    assert(
      !components.some(
        (part) =>
          /[:\x00-\x1f]/.test(part) ||
          /[. ]$/.test(part) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      ),
      'ACCESS_DENIED',
      '不支持设备路径、数据流或不明确的文件别名。',
    );
    assert(!components.some(sensitive), 'ACCESS_DENIED', '该路径属于敏感或内部数据。');
    let current = this.root;
    for (const component of components) {
      current = path.join(current, component);
      try {
        const stat = await fs.lstat(current);
        if (stat.isSymbolicLink()) {
          assert(!writing, 'ACCESS_DENIED', '专用写工具不修改符号链接路径。');
          const real = await fs.realpath(current);
          assert(
            isInside(this.root, real) &&
              !this.protectedPaths.some((p) => isInside(p, real)) &&
              !path.relative(this.root, real).split(path.sep).some(sensitive),
            'ACCESS_DENIED',
            '链接目标超出读取范围。',
          );
        }
      } catch (error) {
        if (!absent(error)) throw error;
        break;
      }
    }
    return target;
  }
}

import { assert, PraxisError } from '@praxis/contracts';
import { z } from 'zod';

export function encodeRequest(
  operation: number,
  fields: Buffer[],
  createParents = false,
  mode = 0o644,
) {
  assert(fields.length === 6, 'FILE_NATIVE_PROTOCOL', '文件请求字段数量无效。');
  const header = Buffer.alloc(44);
  header.write('PXFSv001');
  header.writeUInt32LE(operation, 8);
  header.writeUInt32LE(Number(createParents), 12);
  header.writeUInt32LE(mode, 16);
  fields.forEach((value, index) => {
    assert(
      value.length <= (index < 4 ? 4096 : 2 * 1024 * 1024),
      'FILE_TOO_LARGE',
      '文件请求超过限制。',
    );
    header.writeUInt32LE(value.length, 20 + index * 4);
  });
  return Buffer.concat([header, ...fields]);
}
const errors: Record<string, string> = {
  FILE_NATIVE_UNAVAILABLE: '原生文件组件不可用，请构建或安装对应平台组件。',
  ACCESS_DENIED: '路径不符合目录句柄访问策略，或文件具有多个硬链接。',
  WORKSPACE_CHANGED: '工作区目录身份已变化，请重新打开工作区。',
  FILE_NOT_FOUND: '文件不存在。',
  FILE_ALREADY_EXISTS: '文件已存在，不能覆盖创建。',
  FILE_VERSION_CONFLICT: '发布前文件已变化，请重新读取。',
  FILE_CHANGED_DURING_READ: '读取期间文件发生变化。',
  UNSUPPORTED_FILE: '只支持普通文件。',
  FILE_TOO_LARGE: '文件超过 2 MiB。',
  FILE_CANCELLED: '文件操作已取消。',
  FILE_CLEANUP_FAILED: '无法确认临时文件清理结果，请检查工作区。',
  FILE_NATIVE_FAILED: '原生文件操作失败，请检查权限和磁盘状态。',
  FILE_NATIVE_PROTOCOL: '原生文件组件协议不匹配，请重新构建或安装。',
  FILE_NATIVE_LIMIT: '目录层级超过限制。',
};
export function decodeResponse(data: Buffer) {
  const end = data.indexOf(10);
  assert(end >= 0, 'FILE_NATIVE_PROTOCOL', '原生文件响应不完整。');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(0, end));
  const metadata: unknown = JSON.parse(text);
  const status = z
    .object({ status: z.enum(['ok', 'error']), code: z.string().optional() })
    .parse(metadata);
  if (status.status === 'error') {
    const code =
      status.code && Object.hasOwn(errors, status.code) ? status.code : 'FILE_NATIVE_FAILED';
    throw new PraxisError(code, errors[code] ?? '原生文件操作失败。');
  }
  return { metadata, body: data.subarray(end + 1) };
}
export const readResponse = z.object({
  status: z.literal('ok'),
  identity: z.string().regex(/^\d+:\d+$/),
  mode: z.number().int().min(0).max(0o777),
  nlink: z.literal(1),
  bytes: z
    .number()
    .int()
    .min(0)
    .max(2 * 1024 * 1024),
});
export const listResponse = z.object({
  status: z.literal('ok'),
  incomplete: z.boolean(),
  entries: z
    .array(
      z.object({
        name: z
          .string()
          .min(1)
          .refine(
            (name) => !name.includes('/') && !name.includes('\0') && name !== '.' && name !== '..',
          ),
        type: z.enum(['file', 'directory', 'symlink', 'other']),
      }),
    )
    .max(10000),
});
export const writeResponse = z.object({
  status: z.literal('ok'),
  createdDirectories: z.array(z.string()).max(256),
});
export type NativeDirectoryEntry = z.infer<typeof listResponse>['entries'][number];

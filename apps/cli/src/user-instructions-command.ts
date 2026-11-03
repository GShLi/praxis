import type { startHost } from '@praxis/client-host';
import { assert, PraxisError, type UserInstructionSettings } from '@praxis/contracts';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import type { CliOptions } from './options.ts';

async function instructionText(filename: string) {
  const file = await open(
    path.resolve(filename),
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    const stat = await file.stat();
    assert(
      stat.isFile() && stat.size <= 16384,
      'INSTRUCTIONS_LIMIT',
      '请选择最多 16 KiB 的 UTF-8 文本文件。',
    );
    const bytes = Buffer.alloc(16385);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    assert(offset <= 16384, 'INSTRUCTIONS_LIMIT', '用户指令超过 16 KiB。');
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, offset));
    } catch {
      throw new PraxisError('INSTRUCTIONS_ENCODING', '指令文件必须是 UTF-8 文本。');
    }
  } finally {
    await file.close();
  }
}
export async function userInstructionsCommand(
  host: Awaited<ReturnType<typeof startHost>>,
  values: CliOptions,
  positionals: string[],
) {
  const action = positionals[1] ?? 'show';
  assert(
    ['show', 'set', 'disable'].includes(action),
    'INVALID_COMMAND',
    'instructions 支持 show / set FILE --revision N / disable --revision N。',
  );
  const current = await host.rpc.request<UserInstructionSettings>('user-instructions/read');
  if (action === 'show') {
    console.log(JSON.stringify(current, null, 2));
    return;
  }
  assert(
    values.revision !== undefined && /^(0|[1-9]\d*)$/.test(values.revision),
    'CONFIG_REVISION_REQUIRED',
    '请先 instructions show，再用 --revision N 指定看到的版本。',
  );
  const revision = Number(values.revision);
  assert(
    Number.isSafeInteger(revision) && revision === current.revision,
    'CONFIG_CONFLICT',
    '用户指令已变化，请重新查看。',
  );
  const filename = positionals[2];
  assert(action !== 'set' || filename, 'INVALID_COMMAND', '缺少 UTF-8 指令文件。');
  const value =
    action === 'set' && filename
      ? { enabled: true, text: await instructionText(filename) }
      : { ...current.value, enabled: false };
  const saved = await host.rpc.request<UserInstructionSettings>('user-instructions/save', {
    expectedRevision: revision,
    value,
  });
  console.log(
    JSON.stringify({
      revision: saved.revision,
      enabled: saved.value.enabled,
      effective: 'next-turn',
    }),
  );
}

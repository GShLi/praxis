import { assert } from '@praxis/contracts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SecretBackend } from './types.ts';
import { secretProcess } from './secret-process.ts';

export class NativeSecretBackend implements SecretBackend {
  private executable: string;
  constructor(private mode = process.env.PRAXIS_SECRET_STORE ?? 'auto') {
    assert(
      ['auto', 'memory'].includes(mode),
      'SECRET_STORE_CONFIG',
      'PRAXIS_SECRET_STORE 仅支持 auto 或 memory。',
    );
    const binary = `praxis-secret${process.platform === 'win32' ? '.exe' : ''}`;
    this.executable =
      process.platform === 'linux'
        ? '/usr/bin/secret-tool'
        : process.env.PRAXIS_NATIVE_DIR
          ? path.join(process.env.PRAXIS_NATIVE_DIR, binary)
          : fileURLToPath(
              new URL(
                `${import.meta.url.endsWith('.mjs') ? '../../' : '../../../../'}build/native/${binary}`,
                import.meta.url,
              ),
            );
  }
  private async invoke(
    action: 'get' | 'set' | 'delete',
    key: string,
    value: string,
    signal: AbortSignal,
  ) {
    assert(this.mode !== 'memory', 'SECRET_STORE_UNAVAILABLE', '已选择仅内存凭据存储。');
    assert(/^[a-f0-9]{64}$/.test(key), 'SECRET_REFERENCE_INVALID', '凭据引用无效。');
    const linux = process.platform === 'linux';
    // Ubuntu's secret-tool 0.20.5 silently stops reading stdin at 8192 bytes.
    // New credentials can use the explicit memory fallback; OS rotation must fail before writing.
    assert(
      !linux || action !== 'set' || Buffer.byteLength(value) <= 8192,
      'SECRET_STORE_UNAVAILABLE',
      'Linux 凭据组件无法可靠保存超过 8 KiB 的内容。',
    );
    const args = linux
      ? [
          ...(action === 'set'
            ? ['store', '--label=Praxis MCP']
            : [action === 'get' ? 'lookup' : 'clear']),
          'service',
          'ai.praxis.mcp',
          'account',
          key,
        ]
      : [action, key];
    const result = await secretProcess(this.executable, args, value, signal);
    // secret-tool uses exit 1 both for absence and service errors; only quiet, empty output is absence.
    const absent = action !== 'set' && result.code === (linux ? 1 : 44);
    if (absent && (!linux || (!result.stderrPresent && result.output.length === 0)))
      return undefined;
    assert(result.code === 0, 'SECRET_STORE_UNAVAILABLE', '系统凭据存储不可用。');
    // secret-tool appends a newline only for a terminal; our stdout is always a private pipe.
    return result.output;
  }
  async set(key: string, value: string, signal: AbortSignal) {
    await this.invoke('set', key, value, signal);
  }
  get(key: string, signal: AbortSignal) {
    return this.invoke('get', key, '', signal);
  }
  async delete(key: string, signal: AbortSignal) {
    await this.invoke('delete', key, '', signal);
  }
}

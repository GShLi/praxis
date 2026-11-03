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
    if (action !== 'set' && result.code === (linux ? 1 : 44)) return undefined;
    assert(result.code === 0, 'SECRET_STORE_UNAVAILABLE', '系统凭据存储不可用。');
    return linux ? result.output.replace(/\n$/, '') : result.output;
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

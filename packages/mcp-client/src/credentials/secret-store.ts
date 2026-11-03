import { assert, PraxisError } from '@praxis/contracts';
import type { SecretBackend, SecretStorage } from './types.ts';

/** Each profile owns its memory fallback. No file or log receives a plaintext secret. */
export class SecretStore {
  private memory = new Map<string, string>();
  private lifetime = new AbortController();
  private pending = new Set<Promise<unknown>>();
  constructor(private native: SecretBackend) {}
  put(key: string, value: string, cancellation?: AbortSignal): Promise<SecretStorage> {
    return this.run(async (signal) => {
      assert(
        value.length > 0 && Buffer.byteLength(value) <= 65536,
        'SECRET_LIMIT',
        '凭据超过存储限制。',
      );
      try {
        await this.native.set(key, value, signal);
        signal.throwIfAborted();
        return 'os';
      } catch (error) {
        if (signal.aborted) {
          try {
            await this.native.delete(key, AbortSignal.timeout(2000));
          } catch {
            throw new PraxisError('SECRET_CLEANUP_UNKNOWN', '取消后未能确认系统凭据已清理。');
          }
          signal.throwIfAborted();
        }
        if (!(error instanceof PraxisError) || error.code !== 'SECRET_STORE_UNAVAILABLE')
          throw error;
        assert(
          this.memory.size < 64 || this.memory.has(key),
          'SECRET_LIMIT',
          '临时凭据数量已达到上限。',
        );
        this.memory.set(key, value);
        return 'memory';
      }
    }, cancellation);
  }
  get(key: string, storage: SecretStorage, signal?: AbortSignal) {
    return this.run(
      (scope) =>
        storage === 'memory' ? Promise.resolve(this.memory.get(key)) : this.native.get(key, scope),
      signal,
    );
  }
  hasMemory(key: string) {
    return !this.lifetime.signal.aborted && this.memory.has(key);
  }
  delete(key: string, storage: SecretStorage) {
    return this.run(async (signal) => {
      if (storage === 'memory') this.memory.delete(key);
      else await this.native.delete(key, signal);
    });
  }
  private run<T>(
    action: (signal: AbortSignal) => Promise<T>,
    cancellation?: AbortSignal,
  ): Promise<T> {
    const signal = AbortSignal.any([this.lifetime.signal, ...(cancellation ? [cancellation] : [])]);
    const operation = Promise.resolve()
      .then(async () => {
        signal.throwIfAborted();
        const result = await action(signal);
        signal.throwIfAborted();
        return result;
      })
      .finally(() => this.pending.delete(operation));
    this.pending.add(operation);
    return operation;
  }
  async close() {
    this.lifetime.abort(new PraxisError('SECRET_STORE_CLOSED', '凭据存储已关闭。'));
    await Promise.allSettled([...this.pending]);
    this.memory.clear();
  }
}

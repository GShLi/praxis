import { fingerprint } from '@praxis/config';
import { assert } from '@praxis/contracts';
import { randomUUID } from 'node:crypto';
import type { CatalogBinding } from './catalog-types.ts';

export class ScopedReferences<T> {
  private values = new Map<string, { scope: string; value: T; expires: number }>();
  issue(scope: CatalogBinding & { generation: string }, value: T) {
    for (const [key, record] of this.values)
      if (record.expires < Date.now()) this.values.delete(key);
    assert(this.values.size < 1000, 'MCP_REFERENCE_LIMIT', '资源引用数量超限。');
    const id = randomUUID();
    this.values.set(id, {
      scope: fingerprint(scope),
      value: structuredClone(value),
      expires: Date.now() + 30 * 60_000,
    });
    return id;
  }
  read(scope: CatalogBinding & { generation: string }, id: string) {
    const record = this.values.get(id);
    assert(
      record && record.scope === fingerprint(scope) && record.expires >= Date.now(),
      'MCP_REFERENCE_EXPIRED',
      '引用已过期或不属于当前服务器/用户/目录。',
    );
    return structuredClone(record.value);
  }
}

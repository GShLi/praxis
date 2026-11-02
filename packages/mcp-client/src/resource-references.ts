import { assert } from '@praxis/contracts';
import { ScopedReferences, type CatalogBinding } from '@praxis/mcp-core';
import type { ResourceCatalog, ResourceEntry, ResourceKind } from './resource-catalog.ts';

type Reference = { catalog: ResourceCatalog } & (
  | { type: 'resource' | 'template'; entry: ResourceEntry }
  | { type: 'page'; offset: number; limit: number }
);
type StoredReference =
  | { type: 'resource' | 'template'; index: number }
  | { type: 'page'; offset: number; limit: number };
export class ResourceReferences {
  private references = new ScopedReferences<StoredReference>();
  private bindings = new Map<
    string,
    { key: string; scope: CatalogBinding & { generation: string } }
  >();
  private current = new Map<string, ResourceCatalog>();
  private key(catalog: ResourceCatalog) {
    return JSON.stringify([catalog.binding.serverId, catalog.kind]);
  }
  remember(catalog: ResourceCatalog) {
    this.current.set(this.key(catalog), catalog);
  }
  invalidate(serverId: string, kind: ResourceKind) {
    this.current.delete(JSON.stringify([serverId, kind]));
  }
  issue(value: Reference) {
    const scope = { ...value.catalog.binding, generation: value.catalog.generation };
    // References retain only an index; copying the entire catalog for each URI multiplies memory use.
    const stored: StoredReference =
      value.type === 'page'
        ? { type: 'page', offset: value.offset, limit: value.limit }
        : { type: value.type, index: value.catalog.entries.indexOf(value.entry) };
    const ref = this.references.issue(scope, stored);
    this.bindings.set(ref, { key: this.key(value.catalog), scope });
    return ref;
  }
  read(ref: string): Reference {
    const binding = this.bindings.get(ref);
    const catalog = binding && this.current.get(binding.key);
    assert(
      binding && catalog && catalog.generation === binding.scope.generation,
      'MCP_REFERENCE_EXPIRED',
      '资源引用已失效或不属于当前任务。',
    );
    const stored = this.references.read(binding.scope, ref);
    if (stored.type === 'page') return { ...stored, catalog };
    const entry = catalog.entries[stored.index];
    assert(entry, 'MCP_REFERENCE_EXPIRED', '资源条目已失效。');
    return { type: stored.type, entry, catalog };
  }
  page(ref: string, serverId: string, kind: ResourceKind, limit: number) {
    const value = this.read(ref);
    assert(
      value.type === 'page' &&
        value.catalog.binding.serverId === serverId &&
        value.catalog.kind === kind &&
        value.limit === limit,
      'MCP_REFERENCE_EXPIRED',
      '分页引用不属于此次查询。',
    );
    return value;
  }
}

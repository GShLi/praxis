import { useState } from 'react';
import { providerModels, parseModelSelection } from '@praxis/model-core/provider-models';
import type { Provider } from '../client-types.ts';
import { SettingsIcon } from './controls.tsx';

export function ProviderList({
  providers,
  selected,
  select,
  defaultId,
}: {
  providers: Provider[];
  selected: string | undefined;
  select: (id: string) => void;
  defaultId: string;
}) {
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all');
  const visible = providers.filter(
    (p) =>
      (filter === 'all' || p.enabled === (filter === 'enabled')) &&
      `${p.name} ${p.baseUrl} ${providerModels(p)
        .map((m) => m.model)
        .join(' ')}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  return (
    <aside className="provider-list" aria-label="模型供应商列表">
      <div className="provider-list-search">
        <SettingsIcon name="search" />
        <input
          type="search"
          aria-label="搜索供应商"
          placeholder="搜索供应商或模型"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="provider-list-filter">
        <span>{visible.length} 个供应商</span>
        <select
          aria-label="筛选供应商状态"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">全部</option>
          <option value="enabled">已启用</option>
          <option value="disabled">已停用</option>
        </select>
      </div>
      <div className="provider-list-items">
        {visible.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`provider-list-item ${p.id === selected ? 'selected' : ''}`}
            aria-current={p.id === selected ? 'true' : undefined}
            onClick={() => select(p.id)}
          >
            <span className="provider-symbol" aria-hidden="true">
              {p.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="provider-list-label">
              <strong>{p.name}</strong>
              <small>
                {providerModels(p).length} 个模型 · {p.enabled ? '已启用' : '已停用'}
              </small>
            </span>
            {defaultId && parseModelSelection(defaultId).providerId === p.id && (
              <span className="settings-badge">默认</span>
            )}
          </button>
        ))}
      </div>
      {!visible.length && (
        <p className="provider-list-empty">
          {providers.length ? '没有匹配的供应商' : '还没有供应商'}
        </p>
      )}
    </aside>
  );
}

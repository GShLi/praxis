import { useState } from 'react';
import { providerModels } from '@praxis/model-core/provider-models';
import type { PraxisClient, Provider } from '../client-types.ts';
import { ProviderOverview } from './ProviderOverview.tsx';
import { ProviderModelsTab } from './ProviderModelsTab.tsx';
import { useProviderCatalog } from './useProviderCatalog.ts';

export function ProviderDetails({
  provider,
  client,
  edit,
  remove,
  defaultId,
  setDefault,
}: {
  provider: Provider;
  client: PraxisClient;
  edit: () => void;
  remove: () => void;
  defaultId: string;
  setDefault: (id: string) => void;
}) {
  const [tab, setTab] = useState<'overview' | 'models'>('overview');
  const catalog = useProviderCatalog(client);
  const models = providerModels(provider);
  return (
    <section className="provider-detail" aria-label={`${provider.name} 详情`}>
      <header className="provider-detail-heading">
        <span className="provider-symbol" aria-hidden="true">
          {provider.name.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <h3>{provider.name}</h3>
          <p>
            {models.length} 个模型 <span>·</span>{' '}
            <span className={`settings-badge ${provider.enabled ? 'available' : ''}`}>
              {provider.enabled ? '已启用' : '已停用'}
            </span>
          </p>
        </div>
        <button id={`provider-edit-${provider.id}`} className="secondary-button" onClick={edit}>
          编辑供应商
        </button>
      </header>
      <div className="provider-tabs" role="tablist" aria-label="供应商详情">
        {(['overview', 'models'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`provider-tab-${id}`}
            aria-controls={`provider-panel-${id}`}
            aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            onKeyDown={(e) => {
              if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
                e.preventDefault();
                const next =
                  e.key === 'Home'
                    ? 'overview'
                    : e.key === 'End'
                      ? 'models'
                      : tab === 'overview'
                        ? 'models'
                        : 'overview';
                setTab(next);
                document.getElementById(`provider-tab-${next}`)?.focus();
              }
            }}
          >
            {id === 'overview' ? '概览' : `模型 (${models.length})`}
          </button>
        ))}
      </div>
      {tab === 'overview' ? (
        <ProviderOverview provider={provider} client={client} catalog={catalog} remove={remove} />
      ) : (
        <ProviderModelsTab
          provider={provider}
          defaultId={defaultId}
          setDefault={setDefault}
          edit={edit}
        />
      )}
    </section>
  );
}

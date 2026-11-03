import { useProvidersPage } from './useProvidersPage.ts';
import type { PraxisClient, Provider } from '../client-types.ts';
import { Empty, SettingsIcon, Status } from './controls.tsx';
import { ProviderEditor } from './ProviderEditor.tsx';
import { ProviderList } from './ProviderList.tsx';
import { ProviderDetails } from './ProviderDetails.tsx';
import { ProviderDeleteDialog } from './ProviderDeleteDialog.tsx';

export function Models({
  client,
  providers,
  saved,
}: {
  client: PraxisClient;
  providers: Provider[];
  saved: () => Promise<void>;
}) {
  const {
    selected,
    setSelectedId,
    editing,
    setEditing,
    deleting,
    setDeleting,
    defaultId,
    message,
    busy,
    refreshFailed,
    refresh,
    setDefault,
    deleted,
  } = useProvidersPage(providers, saved);
  return (
    <>
      <header className="providers-page-heading">
        <div>
          <h2>模型供应商</h2>
          <p>统一管理连接与模型，供 ChatBot 和 Agent 使用。</p>
        </div>
        <button
          id="provider-add"
          className="primary-button compact"
          disabled={busy}
          onClick={() => setEditing({ provider: undefined })}
        >
          <SettingsIcon name="plus" />
          添加供应商
        </button>
      </header>
      <Status message={message} />
      {refreshFailed && (
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => void refresh('重新加载供应商列表。')}
        >
          重新加载列表
        </button>
      )}
      <div className="providers-workspace" inert={busy} aria-busy={busy}>
        <ProviderList
          providers={providers}
          selected={selected?.id}
          select={setSelectedId}
          defaultId={defaultId}
        />
        {selected ? (
          <ProviderDetails
            key={`${selected.id}:${selected.revision}`}
            provider={selected}
            client={client}
            edit={() => setEditing({ provider: selected })}
            remove={() => setDeleting(selected)}
            defaultId={defaultId}
            setDefault={setDefault}
          />
        ) : (
          <Empty
            icon="model"
            title="添加你的第一个模型供应商"
            action={
              <button
                className="secondary-button"
                onClick={() => setEditing({ provider: undefined })}
              >
                添加供应商
              </button>
            }
          >
            填写一次地址和 Key，即可管理并使用该供应商的多个模型。
          </Empty>
        )}
      </div>
      {editing && (
        <ProviderEditor
          provider={editing.provider}
          client={client}
          close={() => setEditing(null)}
          saved={() => {
            setEditing(null);
            void refresh('供应商已保存。');
          }}
        />
      )}
      {deleting && (
        <ProviderDeleteDialog
          provider={deleting}
          client={client}
          close={() => setDeleting(null)}
          deleted={deleted}
        />
      )}
    </>
  );
}

import { useEffect, useRef, useState } from 'react';
import { providerModels } from '@praxis/model-core/provider-models';
import type { PraxisClient, Provider } from '../client-types.ts';
import { SettingsDialog } from './SettingsDialog.tsx';
import { errorText } from './controls.tsx';

export function ProviderDeleteDialog({
  provider,
  client,
  close,
  deleted,
}: {
  provider: Provider;
  client: PraxisClient;
  close: () => void;
  deleted: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const active = useRef(true),
    deleting = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const remove = async () => {
    if (deleting.current || !client.deleteProvider) return;
    deleting.current = true;
    setBusy(true);
    setError('');
    try {
      await client.deleteProvider(provider.id, provider.revision);
      if (active.current) deleted();
    } catch (failure) {
      if (active.current) setError(errorText(failure));
    } finally {
      deleting.current = false;
      if (active.current) setBusy(false);
    }
  };
  return (
    <SettingsDialog title={`删除 ${provider.name}？`} busy={busy} close={close}>
      {(requestClose) => (
        <>
          <div className="dialog-body">
            <p>
              将删除此供应商、已保存的 API Key 和 {providerModels(provider).length}{' '}
              个模型。已有会话记录会保留，新任务将无法再使用这些模型。
            </p>
            {error && (
              <p role="alert" className="settings-feedback error">
                {error}
              </p>
            )}
          </div>
          <footer className="settings-form-footer dialog-footer">
            <button
              autoFocus
              className="secondary-button"
              data-dialog-focus
              disabled={busy}
              onClick={requestClose}
            >
              取消
            </button>
            <button className="danger-button" disabled={busy} onClick={() => void remove()}>
              {busy ? '正在删除…' : '确认删除'}
            </button>
          </footer>
        </>
      )}
    </SettingsDialog>
  );
}

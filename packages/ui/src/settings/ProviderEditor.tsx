import type { PraxisClient, Provider } from '../client-types.ts';
import { useEffect, useRef } from 'react';
import { ProviderConnectionFields } from './ProviderConnectionFields.tsx';
import { ProviderModelPicker } from './ProviderModelPicker.tsx';
import { SettingsDialog } from './SettingsDialog.tsx';
import { useProviderEditor } from './useProviderEditor.ts';

export function ProviderEditor({
  provider,
  client,
  saved,
  close,
}: {
  provider: Provider | undefined;
  client: PraxisClient;
  saved: () => void;
  close: () => void;
}) {
  const state = useProviderEditor(provider, client, saved);
  const error = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.error) error.current?.scrollIntoView({ block: 'nearest' });
  }, [state.error]);
  return (
    <SettingsDialog
      title={provider ? `编辑供应商 · ${provider.name}` : '添加模型供应商'}
      dirty={state.dirty}
      busy={state.busy}
      close={close}
    >
      {(requestClose) => (
        <form
          className="settings-editor provider-editor"
          onSubmit={(e) => void state.submit(e)}
          aria-busy={state.busy}
        >
          <div className="dialog-body">
            <fieldset disabled={state.busy}>
              <ProviderConnectionFields state={state} creating={!provider} />
              <ProviderModelPicker state={state} />
              <label className="settings-checkbox provider-enable">
                <input
                  type="checkbox"
                  checked={state.draft.enabled}
                  onChange={(e) => state.change({ enabled: e.target.checked })}
                />
                启用此供应商
              </label>
            </fieldset>
            {state.error && (
              <p ref={error} className="settings-feedback error" role="alert">
                {state.error}
              </p>
            )}
          </div>
          <footer className="settings-form-footer dialog-footer">
            <button
              type="button"
              className="secondary-button"
              disabled={state.busy}
              onClick={requestClose}
            >
              取消
            </button>
            <button
              type="submit"
              className="primary-button compact"
              disabled={
                state.busy || state.catalog.state === 'loading' || !state.draft.models.length
              }
            >
              {state.busy ? '正在保存…' : '保存供应商'}
            </button>
          </footer>
        </form>
      )}
    </SettingsDialog>
  );
}

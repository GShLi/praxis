import type { useLogout } from '../app/useLogout.ts';
import { SettingsDialog } from '../settings/SettingsDialog.tsx';

export function LogoutDialog({ state }: { state: ReturnType<typeof useLogout> }) {
  if (!state.open) return null;
  return (
    <SettingsDialog title="退出当前客户端？" busy={state.busy} close={state.cancel}>
      {() => (
        <section className="dialog-discard">
          <p>
            {state.count
              ? `当前有 ${state.count} 个任务正在执行或等待处理。退出将停止这些任务，保留已保存的历史和草稿。`
              : '退出后可以重新登录，已保存的历史和草稿仍然保留。'}
          </p>
          {state.error && (
            <p role="alert" className="form-error">
              {state.error}
            </p>
          )}
          <div className="settings-form-footer">
            <button
              data-dialog-focus
              className="secondary-button"
              disabled={state.busy}
              onClick={state.cancel}
            >
              继续使用
            </button>
            <button
              className="primary-button"
              disabled={state.busy}
              onClick={() => {
                void state.confirm();
              }}
            >
              {state.busy ? '正在退出…' : '退出登录'}
            </button>
          </div>
        </section>
      )}
    </SettingsDialog>
  );
}

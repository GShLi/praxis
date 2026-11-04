import { useSessionManagement } from './useSessionManagement.ts';
import type { PraxisClient, ViewSession } from '../client-types.ts';
import { SettingsDialog } from '../settings/SettingsDialog.tsx';
import { activeStatuses } from './session-groups.ts';

export function SessionManagement({
  client,
  session,
  close,
  saved,
}: {
  client: PraxisClient;
  session: ViewSession;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const { title, setTitle, busy, error, dirty, run } = useSessionManagement(session, saved, close);
  return (
    <SettingsDialog title="管理会话" dirty={dirty} busy={busy} close={close}>
      {(requestClose) => (
        <form
          className="dialog-body"
          onSubmit={(event) => {
            event.preventDefault();
            if (title.trim() && client.renameSession)
              void run(() => client.renameSession!(session.id, title.trim()));
          }}
        >
          <label>
            会话名称
            <input
              data-dialog-focus
              value={title}
              required
              maxLength={200}
              disabled={busy || !client.renameSession}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="settings-form-footer">
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={requestClose}
            >
              取消
            </button>
            <button
              className="primary-button"
              disabled={!dirty || !title.trim() || busy || !client.renameSession}
            >
              {busy ? '正在保存…' : '保存名称'}
            </button>
          </div>
          {client.archiveSession && (
            <section className="session-archive-actions">
              <h3>{session.archived ? '恢复会话' : '归档会话'}</h3>
              <p>
                {activeStatuses.has(session.status)
                  ? '任务结束或停止后可归档。'
                  : '归档会隐藏最近列表中的会话，历史与草稿保留，可随时恢复。'}
              </p>
              <button
                type="button"
                className="secondary-button"
                disabled={busy || dirty || activeStatuses.has(session.status)}
                onClick={() => {
                  void run(() => client.archiveSession!(session.id, !session.archived));
                }}
              >
                {session.archived ? '恢复到最近会话' : '归档会话'}
              </button>
            </section>
          )}
        </form>
      )}
    </SettingsDialog>
  );
}

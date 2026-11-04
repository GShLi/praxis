import { SettingsDialog } from './SettingsDialog.tsx';

export function DiscardChangesDialog({ cancel, discard }: { cancel(): void; discard(): void }) {
  return (
    <SettingsDialog title="放弃未保存的修改？" close={cancel}>
      {() => (
        <section className="dialog-discard">
          <p>你的修改尚未保存。继续后将离开此页面或重新读取已保存版本。</p>
          <div className="settings-form-footer">
            <button data-dialog-focus className="secondary-button" onClick={cancel}>
              继续编辑
            </button>
            <button className="danger-button" onClick={discard}>
              放弃修改并继续
            </button>
          </div>
        </section>
      )}
    </SettingsDialog>
  );
}

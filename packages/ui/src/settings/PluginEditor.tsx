import type { PraxisClient } from '../client-types.ts';
import { Status } from './controls.tsx';
import { SettingsDialog } from './SettingsDialog.tsx';
import type { SettingsFeedback } from './settings-resource.ts';
import { usePluginEditor } from './usePluginEditor.ts';

export function PluginEditor({
  client,
  saving,
  canSave,
  feedback,
  save,
  retry,
  close,
}: {
  client: PraxisClient;
  saving: boolean;
  canSave: boolean;
  feedback?: SettingsFeedback | undefined;
  save(source: string, digest: string): Promise<boolean>;
  retry(): Promise<boolean>;
  close(): void;
}) {
  const form = usePluginEditor(client);
  const busy = saving || form.busy;
  const review = form.review;
  return (
    <SettingsDialog title="安装本地插件" dirty={Boolean(form.source)} busy={busy} close={close}>
      {(requestClose) => (
        <form
          className="settings-editor settings-modal-editor"
          onSubmit={(event) => {
            event.preventDefault();
            void form.inspect();
          }}
        >
          <div className="dialog-body">
            <fieldset disabled={busy}>
              <label>
                已构建插件的目录
                <input
                  data-dialog-focus
                  value={form.source}
                  required
                  onChange={(event) => form.changeSource(event.target.value)}
                  placeholder="/path/to/your-plugin"
                />
              </label>
              {client.selectPluginDirectory && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void form.choose()}
                >
                  选择文件夹…
                </button>
              )}
              <p className="settings-footnote">
                目录中需包含 praxis-plugin.json，不会自动安装包内依赖。
              </p>
              <button
                className="secondary-button"
                disabled={!form.source.trim() || !client.inspectPlugin}
              >
                检查包内容
              </button>
              {review && (
                <div className="plugin-review">
                  <h3>
                    {review.manifest.id} <span>v{review.manifest.version}</span>
                  </h3>
                  <p>{review.warning}</p>
                  <dl>
                    <dt>声明能力</dt>
                    <dd>{review.manifest.capabilities.join(' · ')}</dd>
                    <dt>包大小</dt>
                    <dd>{(review.bytes / 1024).toFixed(1)} KiB</dd>
                    <dt>内容摘要</dt>
                    <dd className="settings-hash">{review.digest}</dd>
                  </dl>
                </div>
              )}
            </fieldset>
            {busy && <Status message={saving ? '正在安装插件…' : '正在处理插件目录…'} />}
            <Status {...form.feedback} />
            {feedback && <Status {...feedback} />}
            {!canSave && (
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => void retry()}
              >
                重试读取插件状态
              </button>
            )}
          </div>
          <div className="settings-form-footer dialog-footer">
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={requestClose}
            >
              取消
            </button>
            <button
              type="button"
              className="primary-button compact"
              disabled={busy || !review || !canSave || !client.installPlugin}
              onClick={() => void form.install(save, close)}
            >
              {saving ? '安装中…' : '信任此来源并安装'}
            </button>
          </div>
        </form>
      )}
    </SettingsDialog>
  );
}

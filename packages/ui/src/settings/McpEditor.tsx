import { Select } from '../controls/Select.tsx';
import { useMcpEditor } from './useMcpEditor.ts';
import type { McpState } from '../client-types.ts';
import { SettingsDialog } from './SettingsDialog.tsx';
import { Status } from './controls.tsx';
import type { SettingsFeedback } from './settings-resource.ts';

export function McpEditor({
  busy,
  save,
  cancel,
  initial,
  feedback,
  canSave,
  retry,
}: {
  busy: boolean;
  save(config: unknown): Promise<boolean>;
  cancel(): void;
  initial?: McpState['value'][number];
  feedback?: SettingsFeedback | undefined;
  canSave: boolean;
  retry(): Promise<boolean>;
}) {
  const form = useMcpEditor(initial);
  const { draft, change } = form;
  return (
    <SettingsDialog
      title={initial ? '编辑远程服务器' : '添加远程服务器'}
      busy={busy}
      dirty={form.dirty}
      close={cancel}
    >
      {(requestClose) => (
        <form
          className="settings-editor settings-modal-editor"
          onSubmit={(event) => {
            event.preventDefault();
            void save(form.config()).then((saved) => {
              if (saved) cancel();
            });
          }}
        >
          <div className="dialog-body">
            <fieldset disabled={busy}>
              <div className="settings-fields">
                <label>
                  名称
                  <input
                    data-dialog-focus
                    value={draft.name}
                    onChange={(e) => change({ name: e.target.value })}
                    required
                    placeholder="例如：文档服务"
                  />
                </label>
                <label>
                  命名空间
                  <input
                    value={draft.namespace}
                    disabled={Boolean(initial)}
                    onChange={(e) => change({ namespace: e.target.value })}
                    required
                    pattern="[a-z][a-z0-9_\-]{0,31}"
                    placeholder="例如：docs"
                  />
                </label>
              </div>
              <label>
                服务器地址
                <input
                  type="url"
                  required
                  value={draft.endpoint}
                  onChange={(e) => change({ endpoint: e.target.value })}
                  placeholder="https://your-server.example/mcp"
                />
              </label>
              <label>
                协议版本
                <Select value={draft.protocol} onChange={(value) => change({ protocol: value })}>
                  <option value="auto">自动协商</option>
                  <option value="2026-07-28">2026-07-28</option>
                  <option value="2025-11-25">2025-11-25</option>
                </Select>
              </label>
              <label className="settings-checkbox">
                <input
                  type="checkbox"
                  checked={draft.tools}
                  onChange={(event) => change({ tools: event.target.checked })}
                />
                允许 Agent 发现并调用工具（每次调用需要确认）
              </label>
              <label className="settings-checkbox">
                <input
                  type="checkbox"
                  checked={draft.privateHost}
                  onChange={(e) => change({ privateHost: e.target.checked })}
                />
                允许此固定地址位于本机或内网
              </label>
              <label className="settings-checkbox">
                <input
                  type="checkbox"
                  checked={draft.resources}
                  onChange={(e) => change({ resources: e.target.checked })}
                />
                允许 Agent 读取文本资源（每次读取需要确认）
              </label>
              <label className="settings-checkbox">
                <input
                  type="checkbox"
                  checked={draft.prompts}
                  onChange={(event) => change({ prompts: event.target.checked })}
                />
                允许用户选择并预览提示词模板
              </label>
            </fieldset>
            {initial && (
              <p className="field-help">
                保存后需要重新检查并启用。更改服务器地址会清除旧地址的本地凭据。
              </p>
            )}
            {feedback && <Status {...feedback} />}
            {!canSave && (
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => void retry()}
              >
                重试读取连接状态
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
            <button className="primary-button compact" disabled={busy || !canSave}>
              {busy ? '保存中…' : '保存连接'}
            </button>
          </div>
        </form>
      )}
    </SettingsDialog>
  );
}

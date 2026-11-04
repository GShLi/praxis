import type { PraxisClient } from '../client-types.ts';
import { Row, Status } from './controls.tsx';
import { useUserInstructions } from './useUserInstructions.ts';
import { useUnsavedForm } from './useUnsavedForm.ts';
import { DiscardChangesDialog } from './DiscardChangesDialog.tsx';

export function Personalization({ client }: { client: PraxisClient }) {
  const form = useUserInstructions(client);
  const guard = useUnsavedForm(form.dirty, form.busy);
  if (!client.userInstructions)
    return <p className="settings-footnote">此客户端尚不支持用户指令。</p>;
  const bytes = new TextEncoder().encode(form.draft.text).byteLength;
  return (
    <section className="settings-section">
      <Row
        title="用户指令"
        description={
          client.desktop
            ? '对本桌面客户端的 ChatBot 与 Agent 生效；CLI 和 Web 各自管理。'
            : '对当前账号的 Web 对话生效；本地客户端各自管理。'
        }
      >
        <label>
          <input
            type="checkbox"
            checked={form.draft.enabled}
            disabled={!form.saved || form.busy || !client.saveUserInstructions}
            onChange={(event) => form.setDraft({ ...form.draft, enabled: event.target.checked })}
          />{' '}
          启用
        </label>
      </Row>
      <label className="personal-instructions-label" htmlFor="personal-instructions">
        你希望知行遵循哪些偏好？
      </label>
      <textarea
        id="personal-instructions"
        className="personal-instructions-input"
        rows={10}
        maxLength={16384}
        placeholder="例如：请使用简体中文；讲解代码时给出简短示例。不要填写密码或 API Key。"
        disabled={!form.saved || form.busy || !client.saveUserInstructions}
        value={form.draft.text}
        onChange={(event) => form.setDraft({ ...form.draft, text: event.target.value })}
      />
      <p className="settings-footnote">
        {bytes} / 16384 字节。指令会发送给所选模型并保留在请求历史中；不能改变工具权限。
      </p>
      <div className="personal-instructions-actions">
        <span className="settings-save-state" role="status">
          {form.operation === 'save'
            ? '正在保存…'
            : form.operation === 'load'
              ? '正在读取…'
              : form.dirty
                ? '有未保存的修改'
                : form.saved
                  ? '与已保存版本一致'
                  : '尚未读取已保存版本'}
        </span>
        <button
          className="secondary-button"
          disabled={form.busy}
          onClick={() => {
            guard.request(() => {
              void form.load();
            });
          }}
        >
          重新读取已保存版本
        </button>
        <button
          className="primary-button"
          disabled={
            !form.saved || !form.dirty || form.busy || bytes > 16384 || !client.saveUserInstructions
          }
          onClick={() => {
            void form.save();
          }}
        >
          {form.busy ? '处理中…' : '保存'}
        </button>
      </div>
      <Status message={form.message} variant={form.variant} />
      {guard.pending && <DiscardChangesDialog cancel={guard.cancel} discard={guard.discard} />}
    </section>
  );
}

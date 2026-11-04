import { Select } from '../controls/Select.tsx';
import { providerModelChoices } from '@praxis/model-core/provider-models';
import { McpPrompts } from './McpPrompts.tsx';
import { Icon } from '../Navigation.tsx';
import { PluginCommands } from './PluginCommands.tsx';
import { GettingStarted } from './GettingStarted.tsx';
import { useComposerActions } from './useComposerActions.ts';
import { ModelSelect } from './ModelSelect.tsx';

import type { AppController } from '../app/useAppController.ts';

export function Composer({
  client,
  providers,
  providerId,
  setProviderId,
  kind,
  selected,
  snapshot,
  question,
  draft,
  setDraft,
  sending,
  error,
  setError,
  inputMode,
  setInputMode,
  input,
  fail,
  running,
  send,
  runPluginCommand,
  prepareMcpSession,
  loadingSession,
  empty,
  workspace,
  setWorkspace,
  openSettings,
  draftPersistent,
  reloadLists,
  setLoadAttempt,
}: Pick<
  AppController,
  | 'client'
  | 'providers'
  | 'providerId'
  | 'setProviderId'
  | 'kind'
  | 'selected'
  | 'snapshot'
  | 'question'
  | 'draft'
  | 'setDraft'
  | 'sending'
  | 'error'
  | 'setError'
  | 'inputMode'
  | 'setInputMode'
  | 'input'
  | 'fail'
  | 'running'
  | 'send'
  | 'runPluginCommand'
  | 'prepareMcpSession'
  | 'loadingSession'
  | 'empty'
  | 'workspace'
  | 'setWorkspace'
  | 'openSettings'
  | 'draftPersistent'
  | 'reloadLists'
  | 'setLoadAttempt'
>) {
  const { stopping, restore, stop } = useComposerActions(
    client,
    selected,
    reloadLists,
    setLoadAttempt,
    fail,
  );
  const modelReady = providerModelChoices(providers).some(
    (model) => model.id === providerId && model.enabled,
  );
  const archived = Boolean(snapshot?.session.archived);
  const ready = !archived && modelReady && (kind !== 'agent' || Boolean(selected || workspace));
  return (
    <div
      className={`composer-region ${draft.includes('\n') || draft.length > 65 || kind === 'agent' ? 'expanded' : ''}`}
    >
      <GettingStarted
        client={client}
        modelReady={modelReady}
        workspace={workspace}
        needsWorkspace={kind === 'agent' && !selected}
        configure={() => openSettings('models')}
        chooseWorkspace={setWorkspace}
      />
      {archived && (
        <p className="recovery-note">
          此会话已归档，历史与草稿仍保留。
          {selected && client.archiveSession && (
            <button type="button" className="text-button" onClick={restore}>
              恢复并继续对话
            </button>
          )}
        </p>
      )}
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button className="icon-button" aria-label="关闭错误提示" onClick={() => setError('')}>
            <Icon name="close" />
          </button>
        </div>
      )}
      {snapshot?.session.status === 'interrupted' && (
        <p className="recovery-note">
          任务已中断。历史已保留，发送新的要求后继续；未确认的工具效果需要核查。
        </p>
      )}
      <form
        className="composer"
        onSubmit={(e) => {
          void send(e);
        }}
      >
        <textarea
          ref={input}
          aria-label={kind === 'agent' ? '描述任务' : '输入消息'}
          placeholder={kind === 'agent' ? '描述你希望完成的任务' : '询问知行 Praxis'}
          value={draft}
          disabled={loadingSession || archived}
          rows={1}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === 'Enter' &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              (localStorage.getItem('praxis-send-mode') !== 'modifier' || e.ctrlKey || e.metaKey)
            ) {
              e.preventDefault();
              if (ready && (!running || kind === 'agent')) void send();
            }
          }}
        />
        <div className="composer-bottom">
          <ModelSelect
            choices={providerModelChoices(providers)}
            value={providerId}
            onChange={setProviderId}
            disabled={loadingSession || sending}
          />
          {kind === 'agent' && running && (
            <Select
              aria-label="输入方式"
              value={inputMode}
              onChange={(value) => setInputMode(value as 'queue' | 'steer')}
            >
              <option value="queue">排队任务</option>
              <option value="steer">追加指导</option>
            </Select>
          )}
          <div className="composer-actions">
            {running && selected && (
              <button
                type="button"
                className="stop-button"
                aria-label={stopping ? '正在停止任务' : '停止任务'}
                disabled={stopping || snapshot?.session.status === 'cancelling'}
                onClick={stop}
              >
                <Icon name="stop" />
              </button>
            )}
            {(!running || kind === 'agent') && (
              <button
                className="send-button"
                type="submit"
                aria-label="发送消息"
                disabled={
                  !ready ||
                  !draft.trim() ||
                  sending ||
                  loadingSession ||
                  (running && kind === 'chat')
                }
              >
                <Icon name="send" />
              </button>
            )}
          </div>
        </div>
      </form>
      {kind === 'agent' && running && (
        <p className="input-mode-note">
          {inputMode === 'queue'
            ? '排队：当前步骤完成后处理这条要求。'
            : '追加指导：向当前任务补充要求，已完成的操作不会撤销。'}
        </p>
      )}
      {draft && (
        <p className="draft-note" role="status">
          {draftPersistent
            ? '草稿已保存在当前客户端，切换会话后可继续编辑。'
            : '草稿保留在当前窗口；浏览器存储不可用，刷新前请复制保存。'}
        </p>
      )}
      {empty && (
        <div className="suggestions">
          {(kind === 'agent'
            ? ['创建一个 HelloWorld 页面', '帮我理解这个项目', '检查项目中的待办事项']
            : ['解释一个复杂概念', '帮我完善一个想法', '写一个 HelloWorld 页面']
          ).map((text, index) => (
            <button
              key={text}
              onClick={() => {
                setDraft(text);
                input.current?.focus();
              }}
            >
              <Icon name={index === 0 ? 'spark' : index === 1 ? 'write' : 'code'} />
              <span>{text}</span>
            </button>
          ))}
        </div>
      )}
      {kind === 'agent' && client.mcpPrompts && (
        <McpPrompts
          client={client}
          selected={selected}
          prepareSession={prepareMcpSession}
          providerId={providerId}
          mode={inputMode}
          turnId={snapshot?.turnId ?? null}
          interacting={Boolean(question || snapshot?.approval)}
          disabled={sending || loadingSession || archived}
        />
      )}
      {client.pluginCommands && client.runPluginCommand && (
        <PluginCommands
          client={client}
          kind={kind}
          disabled={sending || loadingSession || running || archived}
          run={runPluginCommand}
        />
      )}
      <p className="composer-hint">
        {kind === 'agent'
          ? '文件与执行结果以工具记录为准。关闭应用会停止任务。'
          : '知行可能会出错。请核查重要信息。'}
      </p>
    </div>
  );
}

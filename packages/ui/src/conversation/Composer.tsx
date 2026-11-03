import { providerModelChoices } from '@praxis/model-core/provider-models';
import { McpPrompts } from './McpPrompts.tsx';
import { Icon } from '../Navigation.tsx';
import { PluginCommands } from './PluginCommands.tsx';

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
>) {
  return (
    <div
      className={`composer-region ${draft.includes('\n') || draft.length > 65 || kind === 'agent' ? 'expanded' : ''}`}
    >
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
          disabled={loadingSession}
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
              if (!running || kind === 'agent') void send();
            }
          }}
        />
        <div className="composer-bottom">
          <select
            title="选择模型"
            aria-label="选择模型"
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
          >
            <option value="" disabled>
              选择模型
            </option>
            {providerModelChoices(providers)
              .filter((p) => p.enabled)
              .map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name || p.model}
                </option>
              ))}
          </select>
          {kind === 'agent' && running && (
            <select
              aria-label="输入方式"
              value={inputMode}
              onChange={(e) => setInputMode(e.target.value as 'queue' | 'steer')}
            >
              <option value="queue">排队任务</option>
              <option value="steer">追加指导</option>
            </select>
          )}
          <div className="composer-actions">
            {running && selected && (
              <button
                type="button"
                className="stop-button"
                aria-label="停止任务"
                onClick={() => {
                  void client.cancel(selected).catch(fail);
                }}
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
                  !draft.trim() || sending || loadingSession || (running && kind === 'chat')
                }
              >
                <Icon name="send" />
              </button>
            )}
          </div>
        </div>
      </form>
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
          disabled={sending || loadingSession}
        />
      )}
      {client.pluginCommands && client.runPluginCommand && (
        <PluginCommands
          client={client}
          kind={kind}
          disabled={sending || loadingSession || running}
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

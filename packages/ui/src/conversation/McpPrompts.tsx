import { Select } from '../controls/Select.tsx';
import type { PraxisClient } from '../client-types.ts';
import { useMcpPrompts } from './useMcpPrompts.ts';
export function McpPrompts({
  client,
  selected,
  prepareSession,
  providerId,
  mode,
  turnId,
  disabled,
  interacting,
}: {
  client: PraxisClient;
  selected: string | null;
  prepareSession: () => Promise<string>;
  providerId: string;
  mode: 'queue' | 'steer';
  turnId: string | null;
  disabled: boolean;
  interacting: boolean;
}) {
  const state = useMcpPrompts(client, selected, prepareSession, providerId, mode, turnId);
  return (
    <div className="mcp-prompt-control">
      <button type="button" className="text-button" disabled={disabled} onClick={state.show}>
        MCP 提示词
      </button>
      {state.open && interacting && (
        <div role="status">
          <p>MCP 正在等待回答或确认，请使用上方的交互卡片。</p>
          <button type="button" onClick={state.cancel}>
            取消预览
          </button>
        </div>
      )}
      {state.open && !interacting && (
        <div className="mcp-prompt-panel" role="dialog" aria-label="选择 MCP 提示词">
          <div className="mcp-prompt-heading">
            <strong>MCP 提示词</strong>
            <button type="button" onClick={state.cancel}>
              取消
            </button>
          </div>
          <p>先选择模板并预览，确认后作为外部材料提交到当前会话。</p>
          {state.error && (
            <p className="error-banner" role="alert">
              {state.error}
            </p>
          )}
          <label>
            服务器
            <Select
              value={state.serverId}
              disabled={state.busy}
              onChange={(value) => state.selectServer(value)}
            >
              {state.servers.map((server) => (
                <option key={server.id} value={server.id}>
                  {server.displayName}
                </option>
              ))}
            </Select>
          </label>
          {!state.busy && !state.servers.length && (
            <p>请先在设置中配置、检查并启用支持提示词的 MCP 服务器。</p>
          )}
          <p className="mcp-prompt-endpoint">
            {state.servers.find((s) => s.id === state.serverId)?.transport.endpoint}
          </p>
          <button
            type="button"
            disabled={state.busy || !state.serverId}
            onClick={() => void state.list()}
          >
            查看提示词
          </button>
          {state.catalog && (
            <>
              <label>
                模板
                <Select
                  value={state.name}
                  disabled={state.busy}
                  onChange={(value) => state.selectName(value)}
                >
                  {state.catalog.entries.map((entry) => (
                    <option key={entry.name} value={entry.name}>
                      {entry.name}
                    </option>
                  ))}
                </Select>
              </label>
              <p>{state.catalog.entries.find((e) => e.name === state.name)?.description}</p>
              <details>
                <summary>参数说明</summary>
                <pre>
                  {JSON.stringify(
                    state.catalog.entries.find((e) => e.name === state.name)?.arguments,
                    null,
                    2,
                  )}
                </pre>
              </details>
              <label>
                参数（JSON；将发送给上方服务器）
                <textarea
                  value={state.args}
                  disabled={state.busy}
                  onChange={(e) => state.changeArgs(e.target.value)}
                  spellCheck={false}
                />
              </label>
              <button
                type="button"
                disabled={state.busy || !state.name}
                onClick={() => void state.fetchPreview()}
              >
                发送参数并获取预览
              </button>
            </>
          )}
          {state.preview && (
            <>
              <h3>将提交的完整内容</h3>
              <pre className="mcp-prompt-preview">{state.preview.text}</pre>
              {!providerId && <p>请先在输入框选择模型，再应用提示词。</p>}
              <button
                type="button"
                disabled={state.busy || !providerId}
                onClick={() => void state.apply()}
              >
                {mode === 'steer' ? '确认并追加指导' : '确认并加入任务队列'}
              </button>
            </>
          )}
          {state.busy && <p role="status">正在处理…</p>}
        </div>
      )}
    </div>
  );
}

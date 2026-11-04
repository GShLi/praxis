import { Select } from '../controls/Select.tsx';
import type { UserCommand } from '@praxis/contracts';
import type { PraxisClient } from '../client-types.ts';
import { usePluginCommands } from './usePluginCommands.ts';

export function PluginCommands({
  client,
  kind,
  disabled,
  run,
}: {
  client: PraxisClient;
  kind: 'chat' | 'agent';
  disabled: boolean;
  run: (value: Omit<UserCommand, 'sessionId' | 'requestId'>) => Promise<void>;
}) {
  const state = usePluginCommands(client, kind, run);
  return (
    <div className="plugin-commands">
      <button
        type="button"
        className="text-button"
        disabled={disabled || state.busy}
        aria-expanded={state.open}
        onClick={() => state.setOpen(!state.open)}
      >
        插件命令
      </button>
      {state.open && (
        <section className="plugin-command-panel" aria-label="插件命令">
          {state.loading ? (
            <p role="status">正在加载命令…</p>
          ) : !state.items.length ? (
            <p>当前模式没有已启用的插件命令。</p>
          ) : (
            <>
              <label>
                选择命令
                <Select value={state.selected} onChange={(value) => state.setSelected(value)}>
                  {state.items.map((item) => (
                    <option
                      key={`${item.pluginId}/${item.name}`}
                      value={`${item.pluginId}/${item.name}`}
                    >
                      {item.pluginId} / {item.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label>
                参数（JSON）
                <textarea
                  value={state.argumentsText}
                  rows={4}
                  maxLength={131072}
                  onChange={(e) => state.setArgumentsText(e.target.value)}
                  disabled={state.busy}
                />
              </label>
              <details>
                <summary>参数说明</summary>
                <pre>{JSON.stringify(state.command?.parameters, null, 2)}</pre>
              </details>
              <p>直接运行所选插件命令。文件与命令操作仍遵守当前会话权限。</p>
              <button
                type="button"
                className="secondary-button"
                disabled={disabled || state.busy}
                onClick={() => {
                  void state.submit();
                }}
              >
                {state.busy ? '正在提交…' : '运行命令'}
              </button>
            </>
          )}
          {state.error && (
            <p className="form-error" role="alert">
              {state.error}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

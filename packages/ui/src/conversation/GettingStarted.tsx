import { useWorkspaceSelection } from './useWorkspaceSelection.ts';
import type { PraxisClient } from '../client-types.ts';
import './getting-started.css';

export function GettingStarted({
  client,
  modelReady,
  workspace,
  needsWorkspace,
  configure,
  chooseWorkspace,
}: {
  client: PraxisClient;
  modelReady: boolean;
  workspace: string;
  needsWorkspace: boolean;
  configure: () => void;
  chooseWorkspace: (value: string) => void;
}) {
  const { busy, error, select } = useWorkspaceSelection(client, chooseWorkspace);
  if (modelReady && (!needsWorkspace || workspace)) return null;
  return (
    <section className="getting-started" aria-label="开始前的准备">
      <div>
        <strong>{!modelReady ? '先连接一个模型' : '选择任务工作区'}</strong>
        <p>
          {!modelReady
            ? '添加模型供应商并选择可用模型，完成后返回这里继续。'
            : 'Agent 将在你选择的目录中读取和修改文件。'}
        </p>
        <ol>
          <li data-ready={modelReady}>{modelReady ? '✓ 模型已就绪' : '1. 配置模型'}</li>
          {needsWorkspace && (
            <li data-ready={Boolean(workspace)}>
              {workspace ? '✓ 工作区已选择' : '2. 选择工作区'}
            </li>
          )}
        </ol>
        <small>已输入的草稿会保留。</small>
      </div>
      <button
        type="button"
        className="primary-button compact"
        disabled={busy}
        onClick={() => {
          if (!modelReady) configure();
          else void select();
        }}
      >
        {!modelReady ? '配置模型' : busy ? '正在选择…' : '选择工作区'}
      </button>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </section>
  );
}

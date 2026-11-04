import { Copy } from '../MarkdownView.tsx';
import { Icon } from '../Navigation.tsx';
import { DiffViewer } from './DiffViewer.tsx';
import type { FileChange } from './file-change.ts';
import '../styles/task-feedback.css';

export interface ChangePanelProps {
  setPanel: (open: boolean) => void;
  change: FileChange | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

export function ChangePanel({
  setPanel,
  change,
  loading = false,
  error,
  onRetry,
}: ChangePanelProps) {
  return (
    <aside className="detail-panel task-change-panel" aria-label="文件变更" aria-busy={loading}>
      <header>
        <h2>文件变更</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="关闭变更面板"
          onClick={() => setPanel(false)}
        >
          <Icon name="close" />
        </button>
      </header>
      <p className="panel-note">只读历史快照 · 来自本次工具记录，不代表当前磁盘内容。</p>
      {loading ? (
        <div className="panel-empty" role="status">
          正在读取文件变更…
        </div>
      ) : error ? (
        <div className="task-change-error" role="alert">
          <p>无法加载文件变更</p>
          <p>{error}</p>
          {onRetry && (
            <button type="button" className="secondary-button" onClick={onRetry}>
              重试加载
            </button>
          )}
        </div>
      ) : change ? (
        <>
          <div className="change-title">
            {change.path}
            <Copy text={change.path} />
          </div>
          <DiffViewer change={change} />
        </>
      ) : (
        <div className="panel-empty">
          <Icon name="folder" />
          <p>
            选择一条文件修改记录
            <br />
            在这里查看变更
          </p>
        </div>
      )}
    </aside>
  );
}

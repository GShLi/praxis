import { Copy } from '../MarkdownView.tsx';
import { Icon } from '../Navigation.tsx';

import type { AppController } from '../app/useAppController.ts';

export function ChangePanel({ setPanel, change }: Pick<AppController, 'setPanel' | 'change'>) {
  return (
    <aside className="detail-panel">
      <header>
        <h2>文件变更</h2>
        <button className="icon-button" aria-label="关闭变更面板" onClick={() => setPanel(false)}>
          <Icon name="close" />
        </button>
      </header>
      {change ? (
        <>
          <div className="change-title">
            {change.path}
            <Copy text={change.path} />
          </div>
          <p className="panel-note">本次工具记录的历史快照</p>
          {change.before !== null && (
            <section>
              <h3>修改前</h3>
              <pre className="diff-before">{change.before}</pre>
            </section>
          )}
          <section>
            <h3>{change.before === null ? '创建内容' : '修改后'}</h3>
            <pre className="diff-after">{change.after}</pre>
          </section>
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

import { useMemo } from 'react';
import { Copy } from '../MarkdownView.tsx';
import { diffLineText, diffRows, type DiffRow } from './diff-presentation.ts';
import { lineDiff } from './line-diff.ts';
import type { FileChange } from './file-change.ts';
import '../styles/task-feedback.css';

export function DiffViewer({ change }: { change: FileChange }) {
  const diff = useMemo(() => lineDiff(change.before, change.after), [change.before, change.after]);
  const display = useMemo(() => diffRows(diff), [diff]);
  return (
    <section className="task-diff" aria-label="文件行差异">
      <div className="task-diff-summary">
        <span>{change.before === null ? '新建文件' : '文件修改'}</span>
        <span className="task-diff-add">+{diff.additions} 行</span>
        <span className="task-diff-remove">−{diff.deletions} 行</span>
      </div>
      {!diff.complete && (
        <p className="task-note">
          文件较大，仅比较两侧前 1,048,576 个字符、最多 12,000
          行。行数仅统计已比较部分，不代表完整变更。
        </p>
      )}
      {diff.coarse && (
        <p className="task-note">
          变更区域较大，已简化为整段删除和新增；共同前后文仍保留，行数不代表最小编辑量。
        </p>
      )}
      {!diff.additions && !diff.deletions && (
        <p className="task-note">
          {!diff.complete
            ? '已比较部分未发现差异。'
            : change.before === null
              ? '创建了空文件。'
              : '两个快照内容相同。'}
        </p>
      )}
      {display.rows.length > 0 && (
        <div className="task-diff-scroll" tabIndex={0} role="region" aria-label="可滚动的差异内容">
          <table>
            <thead>
              <tr>
                <th scope="col">原行</th>
                <th scope="col">新行</th>
                <th scope="col">变化</th>
                <th scope="col">内容</th>
              </tr>
            </thead>
            <tbody>
              {display.rows.map((row, index) => (
                <DiffTableRow key={index} row={row} complete={diff.complete} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {display.omittedRows > 0 && (
        <p className="task-note">
          为保持流畅，另有 {display.omittedRows} 行展示记录未展开。可复制原始快照查看完整内容。
        </p>
      )}
      <OriginalSnapshots change={change} />
    </section>
  );
}

function DiffTableRow({ row, complete }: { row: DiffRow; complete: boolean }) {
  if (row.kind === 'gap')
    return (
      <tr className="task-diff-gap">
        <td colSpan={4}>⋯ 省略 {row.count} 行未变更内容</td>
      </tr>
    );
  const content = diffLineText(row.raw);
  const labels = { context: '未变更', add: '新增', remove: '删除' };
  return (
    <tr className={`task-diff-${row.kind}`}>
      <td className="task-line-number">{row.beforeLine ?? ''}</td>
      <td className="task-line-number">{row.afterLine ?? ''}</td>
      <td className="task-diff-marker" aria-label={labels[row.kind]}>
        {row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : ' '}
      </td>
      <td className="task-diff-content">
        <code>{content.text || ' '}</code>
        {content.truncated && <span className="task-line-note"> …（本行过长，已截断）</span>}
        {content.ending === 'CRLF' && <span className="task-line-note"> CRLF</span>}
        {content.ending === 'none' && complete && (
          <span className="task-line-note">（末尾无换行）</span>
        )}
      </td>
    </tr>
  );
}

function OriginalSnapshots({ change }: { change: FileChange }) {
  return (
    <details className="task-diff-originals">
      <summary>复制完整历史快照</summary>
      {change.before !== null && (
        <div>
          <span>修改前</span>
          <Copy text={change.before} />
        </div>
      )}
      <div>
        <span>修改后</span>
        <Copy text={change.after} />
      </div>
    </details>
  );
}

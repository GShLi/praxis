import {
  parseToolResult,
  textField,
  toolAction,
  toolOutcome,
  toolSummary,
  toolTarget,
  toolVisualStatus,
} from './tool-presentation.ts';
import '../styles/task-feedback.css';

export function ToolCard({
  content,
  showChange,
}: {
  content: string;
  showChange: (id: string) => void;
}) {
  const result = parseToolResult(content);
  if (!result)
    return (
      <section className="task-tool">
        <p>工具记录 · 无法识别结果格式</p>
        <details>
          <summary>查看原始记录</summary>
          <pre>{content}</pre>
        </details>
      </section>
    );
  const target = toolTarget(result.data);
  const artifactId = textField(result.data, 'diffArtifactId');
  return (
    <section
      className="task-tool"
      aria-label={`${toolAction(result.toolId, result.data)} · ${toolOutcome(result)}`}
    >
      <div className="task-tool-heading">
        <strong>{toolAction(result.toolId, result.data)}</strong>
        <span className="task-status" data-status={toolVisualStatus(result)}>
          {toolOutcome(result)}
        </span>
      </div>
      {target && <p className="task-target">{target}</p>}
      <p>{toolSummary(result)}</p>
      {artifactId && (
        <button type="button" className="task-file-link" onClick={() => showChange(artifactId)}>
          查看文件变更
        </button>
      )}
      {result.truncated && (
        <p className="task-note">工具返回内容已截断，完整内容以对应产物为准。</p>
      )}
      <details>
        <summary>查看工具记录与原始结果</summary>
        <p className="task-note">
          工具：{result.toolId} · 调用耗时：{result.durationMs} 毫秒
        </p>
        <pre>{content}</pre>
      </details>
    </section>
  );
}

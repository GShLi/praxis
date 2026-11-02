import type { ToolResult } from '@praxis/contracts';

export function ToolCard({
  content,
  showChange,
}: {
  content: string;
  showChange: (id: string) => void;
}) {
  let result: ToolResult;
  try {
    result = JSON.parse(content) as ToolResult;
  } catch {
    return (
      <details className="tool">
        <summary>工具结果</summary>
        <pre>{content}</pre>
      </details>
    );
  }
  const data = result.data as
    | { path?: string; diffArtifactId?: string; processState?: string; preview?: string }
    | undefined;
  return (
    <details
      className={`tool ${result.status === 'failed' || result.status === 'denied' ? 'tool-error' : ''}`}
    >
      <summary>
        <span className="tool-dot" />
        <span>{result.toolId ?? '工具'}</span>
        <span className="tool-target">{data?.path?.split(/[\\/]/).at(-1) ?? ''}</span>
        <span className="tool-status">{data?.processState ?? result.status}</span>
      </summary>
      <div className="tool-body">
        {result.error && (
          <p>
            {result.error.code} · {result.error.message}
          </p>
        )}
        <pre>{JSON.stringify(result.data, null, 2)}</pre>
        {data?.diffArtifactId && (
          <button className="text-button" onClick={() => showChange(data.diffArtifactId!)}>
            查看文件变更
          </button>
        )}
      </div>
    </details>
  );
}

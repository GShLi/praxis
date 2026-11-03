import type { PraxisClient } from '../client-types.ts';
import { CopyValue, Row, Status } from './controls.tsx';
import { useDiagnostics } from './useDiagnostics.ts';

export function DiagnosticSettings({ client }: { client: PraxisClient }) {
  const { diagnostics, message, busy, exportReport } = useDiagnostics(client);
  return (
    <>
      {diagnostics && (
        <section className="settings-section">
          <Row title="运行系统">
            <span className="setting-value">
              {String(diagnostics.platform)} · {String(diagnostics.arch)}
            </span>
          </Row>
          <Row title="Node.js">
            <span className="setting-value">{String(diagnostics.node)}</span>
          </Row>
          <details className="settings-diagnostics">
            <summary>查看诊断信息</summary>
            <pre>{JSON.stringify(diagnostics, null, 2)}</pre>
            <CopyValue value={JSON.stringify(diagnostics, null, 2)} />
          </details>
        </section>
      )}
      {client.exportDiagnostics && (
        <section className="settings-section">
          <Row
            title="导出诊断包"
            description="仅包含此客户端的运行标识、状态码、耗时和计数；不含对话、文件正文、Key 或路径。最多 2 MiB、5000 条，不会自动上传。"
          >
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                void exportReport();
              }}
            >
              {busy ? '正在导出…' : '导出诊断包'}
            </button>
          </Row>
        </section>
      )}
      <Status message={message} />
    </>
  );
}

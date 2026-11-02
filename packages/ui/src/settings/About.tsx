import { useEffect, useState } from 'react';
import type { PraxisClient } from '../client.ts';
import { CopyValue, errorText, Row, Status } from './controls.tsx';

export function About({ client }: { client: PraxisClient }) {
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null),
    [message, setMessage] = useState('');
  useEffect(() => {
    void client
      .diagnostics?.()
      .then(setDiagnostics)
      .catch((e) => setMessage(errorText(e)));
  }, [client]);
  return (
    <>
      <div className="settings-about">
        <span className="brand-mark">知</span>
        <h3>知行 Praxis</h3>
        <p>From thought to action.</p>
      </div>
      <section className="settings-section">
        <Row title="应用版本">
          <span className="setting-value">0.1.0 · 开发版本</span>
        </Row>
        <Row title="当前客户端">
          <span className="setting-value">
            {client.desktop ? '桌面端 · ChatBot + Agent' : 'Web · ChatBot'}
          </span>
        </Row>
        {diagnostics && (
          <>
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
          </>
        )}
      </section>
      <Status message={message} />
    </>
  );
}

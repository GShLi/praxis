import type { PraxisClient } from '../client-types.ts';
import { Row } from './controls.tsx';
import { DiagnosticSettings } from './DiagnosticSettings.tsx';

export function About({ client }: { client: PraxisClient }) {
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
      </section>
      <DiagnosticSettings client={client} />
    </>
  );
}

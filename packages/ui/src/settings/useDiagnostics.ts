import { useEffect, useRef, useState } from 'react';
import type { PraxisClient } from '../client-types.ts';
import { errorText } from './controls.tsx';
import { useJsonDownload } from './useJsonDownload.ts';

export function useDiagnostics(client: PraxisClient) {
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const scope = useRef<{ active: boolean; busy: boolean } | null>(null);
  const download = useJsonDownload();
  useEffect(() => {
    const current = { active: true, busy: false };
    scope.current = current;
    setDiagnostics(null);
    setMessage('');
    setBusy(false);
    void client
      .diagnostics?.()
      .then((value) => {
        if (current.active) setDiagnostics(value);
      })
      .catch((error) => {
        if (current.active) setMessage(errorText(error));
      });
    return () => {
      current.active = false;
    };
  }, [client]);
  async function exportReport() {
    const current = scope.current;
    if (!current?.active || current.busy || !client.exportDiagnostics) return;
    current.busy = true;
    setBusy(true);
    setMessage('');
    try {
      const report = await client.exportDiagnostics();
      if (!current.active) return;
      download(report, `praxis-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      setMessage(
        report.truncated
          ? '诊断包已导出；记录超过限制或有无效行，已在包中标明。'
          : '诊断包已导出。',
      );
    } catch (error) {
      if (current.active) setMessage(errorText(error));
    } finally {
      current.busy = false;
      if (current.active) setBusy(false);
    }
  }
  return { diagnostics, message, busy, exportReport };
}

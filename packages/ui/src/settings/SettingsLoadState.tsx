import { Status } from './controls.tsx';

export function SettingsLoadState({
  status,
  error,
  retry,
  label,
}: {
  status: 'loading' | 'ready' | 'error' | 'unsupported';
  error: string;
  retry(): Promise<boolean>;
  label: string;
}) {
  if (status === 'loading') return <Status message={`正在读取${label}…`} />;
  if (status === 'unsupported') return <Status message={`此客户端尚不支持${label}。`} />;
  if (status !== 'error') return null;
  return (
    <div className="settings-load-error">
      <Status variant="error" message={`${label}读取失败：${error}`} />
      <button className="secondary-button" onClick={() => void retry()}>
        重试读取
      </button>
    </div>
  );
}

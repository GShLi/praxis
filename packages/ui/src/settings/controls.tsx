import type { ReactNode } from 'react';
import { useState } from 'react';

export function SettingsIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    sliders: 'M4 7h5m4 0h7M4 17h9m4 0h3M9 4v6m4 4v6',
    model: 'm12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 9 8-4.5M12 12 4 7.5M12 12v9',
    terminal: 'M4 5h16v14H4zM7 9l3 3-3 3m6 0h4',
    connect:
      'm9 15 6-6M7 14l-1 1a3.5 3.5 0 0 0 5 5l4-4a3.5 3.5 0 0 0 0-5m2-1 1-1a3.5 3.5 0 0 0-5-5l-4 4a3.5 3.5 0 0 0 0 5',
    plugin: 'M9 4h6v4h5v6h-5v6H9v-6H4V8h5V4Z',
    data: 'M5 6c0-4 14-4 14 0S5 10 5 6Zm0 0v12c0 4 14 4 14 0V6M5 12c0 4 14 4 14 0',
    person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM5 21v-2a7 7 0 0 1 14 0v2',
    info: 'M12 8h.01M12 11v6M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
    back: 'm10 5-7 7 7 7M3 12h18',
    search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Zm5-1 5 5',
    plus: 'M12 5v14M5 12h14',
    arrow: 'm9 5 7 7-7 7',
    check: 'm5 12 4 4 10-10',
    sun: 'M12 3v2m0 14v2M3 12h2m14 0h2M6 6l1 1m10 10 1 1M6 18l1-1M17 7l1-1M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  };
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.info} />
    </svg>
  );
}

export function Row({
  title,
  description,
  children,
}: {
  title: string;
  description?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="setting-row">
      <div className="setting-row-label">
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </div>
      <div className="setting-row-control">{children}</div>
    </div>
  );
}

export function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon: string;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="settings-empty">
      <span className="settings-empty-icon">
        <SettingsIcon name={icon} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Status({ message }: { message: string }) {
  return message ? (
    <p className="settings-feedback" role="status">
      {message}
    </p>
  ) : null;
}

export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : '操作失败，请重试。';

export function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="secondary-button"
      onClick={() => {
        void navigator.clipboard
          .writeText(value)
          .then(() => setCopied(true))
          .catch(() => setCopied(false));
      }}
    >
      {copied ? '已复制' : '复制'}
    </button>
  );
}

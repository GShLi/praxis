import './connection-state.css';

/** Initial connection and recoverable startup errors share one stable layout. */
export function ConnectionState({
  busy,
  error,
  retry,
}: {
  busy: boolean;
  error: string;
  retry: () => void;
}) {
  return (
    <main className="connection-page">
      <header className="connection-brand">
        <span className="brand-mark">知</span>Praxis
      </header>
      <div className="connection-content">
        <section className="connection-card" aria-labelledby="connection-title" aria-busy={busy}>
          <ConnectionSymbol busy={busy} />
          <div role={busy ? 'status' : 'alert'} aria-live="polite">
            <h1 id="connection-title">{busy ? '正在连接 Praxis' : '暂时无法打开 Praxis'}</h1>
            <p className="connection-description">
              {busy
                ? '正在确认登录状态，请稍候。'
                : '初始化未完成，请重试。若问题持续，请将错误详情提供给管理员。'}
            </p>
          </div>
          <button className="primary-button" disabled={busy} onClick={retry}>
            {busy ? '连接中…' : '重新尝试'}
          </button>
          {!busy && error && (
            <details className="connection-details">
              <summary>查看错误详情</summary>
              <p>{error}</p>
            </details>
          )}
        </section>
      </div>
      <footer>知行合一 · From thought to action</footer>
    </main>
  );
}

function ConnectionSymbol({ busy }: { busy: boolean }) {
  return (
    <span className="connection-symbol" aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {busy ? (
          <>
            <path d="M20 11a8 8 0 0 0-14-5L3 9" />
            <path d="M3 4v5h5M4 13a8 8 0 0 0 14 5l3-3M21 20v-5h-5" />
          </>
        ) : (
          <>
            <path d="M12 8v5M12 16h.01" />
            <circle cx="12" cy="12" r="9" />
          </>
        )}
      </svg>
    </span>
  );
}

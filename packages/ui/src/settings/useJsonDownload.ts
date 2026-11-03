import { useEffect, useRef } from 'react';

/** Revokes temporary URLs on expiry and unmount; does not own fetched user data. */
export function useJsonDownload() {
  const pending = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const urls = pending.current;
    return () => {
      for (const [url, timer] of urls) {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
      }
      urls.clear();
    };
  }, []);
  return (report: unknown, filename: string) => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report)], { type: 'application/json' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    pending.current.set(
      url,
      setTimeout(() => {
        URL.revokeObjectURL(url);
        pending.current.delete(url);
      }, 5000),
    );
  };
}

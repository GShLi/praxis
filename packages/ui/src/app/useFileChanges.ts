import { useEffect, useRef, useState } from 'react';
import type { PraxisClient } from '../client-types.ts';
import { parseFileChangeArtifact, type FileChange } from '../conversation/file-change.ts';

export function useFileChanges(client: PraxisClient, selected: string | null, open: () => void) {
  const [change, setChange] = useState<FileChange | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const request = useRef(0),
    artifact = useRef<string | null>(null),
    current = useRef(selected);
  current.current = selected;
  useEffect(() => {
    request.current++;
    artifact.current = null;
    setChange(null);
    setError('');
    setLoading(false);
    return () => {
      request.current++;
    };
  }, [selected]);
  const showChange = async (id: string) => {
    if (!selected || !client.readArtifact) return;
    const order = ++request.current;
    artifact.current = id;
    setLoading(true);
    setError('');
    setChange(null);
    open();
    try {
      const value = parseFileChangeArtifact(await client.readArtifact(selected, id));
      if (request.current === order && current.current === selected) setChange(value);
    } catch (error) {
      if (request.current === order && current.current === selected)
        setError(error instanceof Error ? error.message : '无法读取变更，请重试。');
    } finally {
      if (request.current === order) setLoading(false);
    }
  };
  return {
    change,
    changeLoading: loading,
    changeError: error,
    showChange,
    retryChange: () => {
      if (artifact.current) void showChange(artifact.current);
    },
  };
}

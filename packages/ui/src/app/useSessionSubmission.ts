import { useState } from 'react';
import type { PraxisClient } from '../client-types.ts';

/** Owns the submission gate shared by prompts and explicit user commands. */
export function useSessionSubmission(
  client: PraxisClient,
  kind: 'chat' | 'agent',
  selected: string | null,
  workspace: string,
  onSelect: (id: string) => void,
  reload: () => Promise<void>,
) {
  const [sending, setSending] = useState(false);
  const submit = async <T>(operation: (id: string) => Promise<T>): Promise<T> => {
    if (sending) throw new Error('上一条请求正在提交。');
    if (kind === 'agent' && !selected && !workspace) throw new Error('请先选择任务工作区。');
    setSending(true);
    try {
      let id = selected;
      if (!id) {
        id = (await client.create(kind, workspace || undefined)).id;
        onSelect(id);
      }
      const value = await operation(id);
      await reload();
      return value;
    } finally {
      setSending(false);
    }
  };
  return { sending, submit };
}

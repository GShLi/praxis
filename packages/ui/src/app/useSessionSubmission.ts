import { useRef, useState } from 'react';
import type { PraxisClient } from '../client-types.ts';

interface SubmissionScope {
  client: PraxisClient;
  kind: 'chat' | 'agent';
  selected: string | null;
  workspace: string;
  identity: string | null;
  onSelect(id: string): void;
  reload(): Promise<void>;
  fail(error: unknown): void;
}

/** Owns the submission gate shared by prompts and explicit user commands. */
export function useSessionSubmission(scope: SubmissionScope) {
  const [sending, setSending] = useState(false);
  const locked = useRef(false),
    current = useRef(scope);
  current.current = scope;
  const submit = async <T>(operation: (id: string) => Promise<T>): Promise<T> => {
    const { client, kind, selected, workspace, identity, reload, fail } = scope;
    if (locked.current) throw new Error('上一条请求正在提交。');
    if (!identity) throw new Error('请先登录。');
    if (kind === 'agent' && !selected && !workspace) throw new Error('请先选择任务工作区。');
    locked.current = true;
    setSending(true);
    try {
      const account = await client.profile?.();
      if (account && account.id !== identity) throw new Error('登录账号已改变，请重新连接。草稿仍然保留。');
      if (current.current.identity !== identity) throw new Error('登录状态已改变，草稿仍然保留。');
      let id = selected;
      if (!id) {
        id = (await client.create(kind, workspace || undefined)).id;
        if (current.current.identity !== identity)
          throw new Error('登录状态已改变，草稿仍然保留。');
        if (current.current.kind === kind && current.current.selected === selected)
          current.current.onSelect(id);
      }
      const value = await operation(id);
      // Accepted input must not be offered for resubmission because a list refresh failed.
      if (current.current.identity === identity) await reload().catch(fail);
      return value;
    } finally {
      locked.current = false;
      setSending(false);
    }
  };
  return { sending, submit };
}

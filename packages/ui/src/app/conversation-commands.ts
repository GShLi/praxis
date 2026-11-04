import type { FormEvent } from 'react';
import type { UserCommand } from '@praxis/contracts';
import type { PraxisClient } from '../client-types.ts';
import type { ConversationState } from './useConversationState.ts';
import type { useConversationDrafts } from './useConversationDrafts.ts';
import type { useSessionSubmission } from './useSessionSubmission.ts';

interface Commands {
  client: PraxisClient;
  state: Pick<
    ConversationState,
    | 'kind'
    | 'selected'
    | 'workspace'
    | 'inputMode'
    | 'snapshot'
    | 'setError'
    | 'selection'
    | 'setFollow'
    | 'input'
    | 'fail'
  >;
  drafts: ReturnType<typeof useConversationDrafts>;
  submission: ReturnType<typeof useSessionSubmission>;
  providerId: string;
}

export function conversationCommands({ client, state, drafts, submission, providerId }: Commands) {
  const {
    kind,
    selected,
    workspace,
    inputMode,
    snapshot,
    setError,
    selection,
    setFollow,
    input,
    fail,
  } = state;
  const { sending, submit } = submission;
  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (!drafts.draft.trim() || sending) return;
    if (!providerId) {
      setError('请先配置模型供应商。');
      return;
    }
    if (kind === 'agent' && !selected && !workspace) {
      setError('请先选择任务工作区。');
      return;
    }
    const receipt = drafts.capture();
    const text = receipt.text.trim();
    let destination = selected;
    setError('');
    try {
      await submit((id) => {
        destination = id;
        return client.send(id, text, providerId, inputMode, snapshot?.turnId ?? null);
      });
      drafts.acknowledge(receipt);
      if (selection.current.kind === kind && selection.current.selected === destination)
        setFollow(true);
    } catch (e) {
      fail(e);
    } finally {
      if (selection.current.kind === kind && selection.current.selected === destination)
        input.current?.focus();
    }
  }
  const runPluginCommand = async (command: Omit<UserCommand, 'sessionId' | 'requestId'>) => {
    const run = client.runPluginCommand?.bind(client);
    if (!run) throw new Error('当前客户端不能执行插件命令。');
    await submit((id) => run({ ...command, sessionId: id, requestId: crypto.randomUUID() }));
  };
  return { send, runPluginCommand, prepareMcpSession: () => submit(async (id) => id) };
}

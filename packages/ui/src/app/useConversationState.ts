import { useEffect, useRef, useState } from 'react';
import type { Snapshot } from '../client-types.ts';
import type { Question } from '../conversation/types.ts';

/** Owns the selected conversation and the view state invalidated with its identity. */
export function useConversationState(authenticated: boolean) {
  const [kind, setKind] = useState<'chat' | 'agent'>('chat');
  const [selected, setSelected] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [partial, setPartial] = useState('');
  const [error, setError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [workspace, setWorkspace] = useState('');
  const [question, setQuestion] = useState<Question | null>(null);
  const [inputMode, setInputMode] = useState<'queue' | 'steer'>('queue');
  const [follow, setFollow] = useState(true);
  const scroll = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const remembered = useRef<Record<'chat' | 'agent', string | null>>({ chat: null, agent: null });
  const selection = useRef({ selected, kind });
  selection.current = { selected, kind };
  useEffect(() => {
    if (!authenticated) {
      setSelected(null);
      setSnapshot(null);
      setPartial('');
      setQuestion(null);
      remembered.current = { chat: null, agent: null };
    }
  }, [authenticated]);
  return {
    kind,
    setKind,
    selected,
    setSelected,
    snapshot,
    setSnapshot,
    partial,
    setPartial,
    error,
    setError,
    loadAttempt,
    setLoadAttempt,
    workspace,
    setWorkspace,
    question,
    setQuestion,
    inputMode,
    setInputMode,
    follow,
    setFollow,
    scroll,
    input,
    remembered,
    selection,
    ...conversationStatus(snapshot, selected, partial),
    fail: (error: unknown) =>
      setError(error instanceof Error ? error.message : '操作失败，请重试。'),
  };
}

export type ConversationState = ReturnType<typeof useConversationState>;

function conversationStatus(snapshot: Snapshot | null, selected: string | null, partial: string) {
  const running = Boolean(
    snapshot &&
      ['running', 'waiting_input', 'waiting_approval', 'cancelling'].includes(
        snapshot.session.status,
      ),
  );
  const loadingSession = Boolean(selected && (!snapshot || snapshot.session.id !== selected));
  const empty =
    (!selected && !partial) ||
    Boolean(snapshot?.session.id === selected && !snapshot.messages.length && !partial);
  return { running, loadingSession, empty };
}

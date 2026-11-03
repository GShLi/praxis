import type { FormEvent } from 'react';
import type { UserCommand } from '@praxis/contracts';
import { useEffect, useRef, useState } from 'react';
import type { PraxisClient, Snapshot, ViewSession } from '../client-types.ts';
import { LocalClient } from '../clients/LocalClient.ts';
import { WebClient } from '../clients/WebClient.ts';
import { useConversationSubscription } from './useConversationSubscription.ts';
import { useIdentity } from './useIdentity.ts';
import { useShell } from './useShell.ts';
import { useSessionSubmission } from './useSessionSubmission.ts';

import type { Question } from '../conversation/types.ts';
export function useAppController(injected?: PraxisClient) {
  const [client] = useState<PraxisClient>(
    () => injected ?? (window.praxis ? new LocalClient(window.praxis) : new WebClient()),
  );
  const [kind, setKind] = useState<'chat' | 'agent'>('chat'),
    [selected, setSelected] = useState<string | null>(null),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState(''),
    [partial, setPartial] = useState(''),
    [error, setError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0),
    [workspace, setWorkspace] = useState('');
  const [question, setQuestion] = useState<Question | null>(null),
    [change, setChange] = useState<{ path: string; before: string | null; after: string } | null>(
      null,
    );
  const [inputMode, setInputMode] = useState<'queue' | 'steer'>('queue'),
    [follow, setFollow] = useState(true);
  const scroll = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : '操作失败，请重试。');
  const {
    authenticated,
    setAuthenticated,
    checking,
    sessions,
    setSessions,
    providers,
    setProviders,
    providerId,
    setProviderId,
    profile,
    setProfile,
    reloadLists,
  } = useIdentity(client, fail);
  const {
    settings,
    searching,
    setSearching,
    sidebar,
    setSidebar,
    panel,
    setPanel,
    openSettings,
    closeSettings,
  } = useShell(authenticated);
  const { sending, submit } = useSessionSubmission(
    client,
    kind,
    selected,
    workspace,
    setSelected,
    reloadLists,
  );
  useEffect(() => {
    const field = input.current;
    if (field) {
      field.style.height = 'auto';
      field.style.height = `${Math.min(field.scrollHeight, 200)}px`;
    }
  }, [draft, settings, selected]);
  useConversationSubscription({
    client,
    selected,
    authenticated,
    loadAttempt,
    setSnapshot,
    setPartial,
    setQuestion,
    setError,
    onKind: setKind,
    onReset: () => {
      setChange(null);
      setFollow(true);
    },
    reloadLists,
    fail,
  });
  useEffect(() => {
    if (follow) scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'auto' });
  }, [snapshot?.messages.length, partial, follow, question]);
  const running = Boolean(
    snapshot &&
      ['running', 'waiting_input', 'waiting_approval', 'cancelling'].includes(
        snapshot.session.status,
      ),
  );
  const newSession = () => {
    setSelected(null);
    setSnapshot(null);
    setFollow(true);
    if (window.innerWidth <= 760) setSidebar(false);
    const preferred = localStorage.getItem('praxis-default-provider');
    if (providers.some((p) => p.id === preferred && p.enabled)) setProviderId(preferred!);
    setDraft('');
    setPartial('');
    setError('');
    setChange(null);
    input.current?.focus();
  };
  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (!draft.trim() || sending) return;
    if (!providerId) {
      openSettings('models');
      setError('请先配置模型提供商。');
      return;
    }
    if (kind === 'agent' && !selected && !workspace) {
      setError('请先选择任务工作区。');
      return;
    }
    const text = draft.trim();
    setError('');
    try {
      await submit((id) => client.send(id, text, providerId, inputMode, snapshot?.turnId ?? null));
      setDraft('');
      setFollow(true);
    } catch (e) {
      fail(e);
    } finally {
      input.current?.focus();
    }
  }
  const showChange = async (id: string) => {
    if (!selected || !client.readArtifact) return;
    try {
      const value = await client.readArtifact(selected, id);
      if (value.kind === 'file-change') {
        setChange(JSON.parse(value.content) as typeof change);
        setPanel(true);
      }
    } catch (e) {
      fail(e);
    }
  };
  const runPluginCommand = async (command: Omit<UserCommand, 'sessionId' | 'requestId'>) => {
    const run = client.runPluginCommand?.bind(client);
    if (!run) throw new Error('当前客户端不能执行插件命令。');
    await submit((id) => run({ ...command, sessionId: id, requestId: crypto.randomUUID() }));
  };
  const logout = async () => {
    await client.logout();
    setAuthenticated(false);
    setSelected(null);
    setSessions([]);
    setProviders([]);
    setProfile(null);
    setDraft('');
    closeSettings();
  };
  const loadingSession = Boolean(selected && (!snapshot || snapshot.session.id !== selected));
  const empty =
    (!selected && !partial) ||
    Boolean(snapshot?.session.id === selected && !snapshot?.messages.length && !partial);
  const chooseSession = (session: ViewSession) => {
    setSelected(session.id);
    setKind(session.kind);
    setError('');
    setSearching(false);
    if (window.innerWidth <= 760) setSidebar(false);
  };
  return {
    client,
    authenticated,
    setAuthenticated,
    checking,
    sessions,
    providers,
    providerId,
    setProviderId,
    kind,
    setKind,
    selected,
    snapshot,
    draft,
    setDraft,
    partial,
    sending,
    error,
    setError,
    settings,
    profile,
    setProfile,
    searching,
    setSearching,
    setLoadAttempt,
    sidebar,
    setSidebar,
    panel,
    setPanel,
    workspace,
    setWorkspace,
    question,
    setQuestion,
    change,
    inputMode,
    setInputMode,
    follow,
    setFollow,
    scroll,
    input,
    fail,
    openSettings,
    closeSettings,
    reloadLists,
    running,
    newSession,
    send,
    runPluginCommand,
    prepareMcpSession: () => submit(async (id) => id),
    showChange,
    logout,
    loadingSession,
    empty,
    chooseSession,
  };
}
export type AppController = ReturnType<typeof useAppController>;

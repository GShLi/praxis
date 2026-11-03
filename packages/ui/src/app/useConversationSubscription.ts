import type { Event } from '@praxis/contracts';
import type { Dispatch, SetStateAction } from 'react';
import { useEffect, useRef } from 'react';
import type { PraxisClient, Snapshot } from '../client-types.ts';
import type { Question } from '../conversation/types.ts';
interface Subscription {
  client: PraxisClient;
  selected: string | null;
  authenticated: boolean;
  loadAttempt: number;
  setSnapshot: Dispatch<SetStateAction<Snapshot | null>>;
  setPartial: Dispatch<SetStateAction<string>>;
  setQuestion: Dispatch<SetStateAction<Question | null>>;
  setError: Dispatch<SetStateAction<string>>;
  onKind: (kind: 'chat' | 'agent') => void;
  onReset: () => void;
  reloadLists: () => Promise<void>;
  fail: (error: unknown) => void;
}
/** Owns one event subscription; cleanup invalidates late snapshots before detaching. */
export function useConversationSubscription(options: Subscription) {
  const { client, selected, authenticated, loadAttempt } = options;
  const latest = useRef(options);
  latest.current = options;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const request = useRef(0);
  useEffect(() => {
    const { setSnapshot, setPartial, setQuestion, setError, onKind, onReset, reloadLists, fail } =
      latest.current;
    if (!selected || !authenticated) {
      setSnapshot(null);
      setPartial('');
      setQuestion(null);
      return;
    }
    let stopped = false,
      off: (() => void) | undefined;
    let cursor = 0;
    const refresh = async () => {
      const order = ++request.current;
      const value = await client.read(selected);
      if (!stopped && selectedRef.current === selected && order === request.current) {
        setSnapshot(value);
        setQuestion(value.question ?? null);
      }
    };
    setPartial('');
    setSnapshot(null);
    setQuestion(null);
    onReset();
    void client
      .read(selected)
      .then((value) => {
        if (stopped) return;
        setSnapshot(value);
        setQuestion(value.question ?? null);
        onKind(value.session.kind);
        cursor = value.throughSeq;
        off = client.listen(
          selected,
          cursor,
          (event: Event) => {
            if (stopped || event.seq <= cursor) return;
            if (event.seq !== cursor + 1) {
              void refresh().catch(fail);
            }
            cursor = event.seq;
            if (event.type === 'question/asked') setQuestion(event.payload as Question);
            if (['question/answered', 'question/closed'].includes(event.type))
              setQuestion((current) =>
                current?.questionId === event.payload.questionId ? null : current,
              );
            if (event.type === 'turn/finished')
              setQuestion((current) => (current?.turnId === event.payload.turnId ? null : current));
            if (event.type.endsWith('/error'))
              setError(String(event.payload.safeMessage ?? '执行失败。'));
            if (['assistant/message', 'generation/finished', 'turn/finished'].includes(event.type))
              setPartial('');
            if (
              event.type.endsWith('/message') ||
              event.type.endsWith('/accepted') ||
              event.type.endsWith('/finished') ||
              event.type.endsWith('/started') ||
              event.type.startsWith('question/') ||
              event.type.startsWith('approval/') ||
              event.type === 'permission/changed'
            )
              void refresh().catch(fail);
            if (event.type.endsWith('/finished')) void reloadLists().catch(fail);
          },
          (text) => {
            if (!stopped) setPartial((current) => current + text);
          },
          fail,
        );
      })
      .catch(fail);
    return () => {
      stopped = true;
      off?.();
    };
  }, [selected, authenticated, client, loadAttempt]);
}

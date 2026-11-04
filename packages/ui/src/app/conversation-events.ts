import type { Event } from '@praxis/contracts';
import type { Dispatch, SetStateAction } from 'react';
import type { Question } from '../conversation/types.ts';

interface EventProjection {
  setQuestion: Dispatch<SetStateAction<Question | null>>;
  setPartial: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
  refresh(): Promise<void>;
  reloadLists(): Promise<void>;
  fail(error: unknown): void;
}

/** Projects event content; ordering and subscription lifetime stay with the caller. */
export function projectConversationEvent(event: Event, projection: EventProjection) {
  const { setQuestion, setPartial, setError, refresh, reloadLists, fail } = projection;
  if (event.type === 'question/asked') setQuestion(event.payload as Question);
  if (['question/answered', 'question/closed'].includes(event.type))
    setQuestion((current) => (current?.questionId === event.payload.questionId ? null : current));
  if (event.type === 'turn/finished')
    setQuestion((current) => (current?.turnId === event.payload.turnId ? null : current));
  if (event.type.endsWith('/error')) setError(String(event.payload.safeMessage ?? '执行失败。'));
  if (['assistant/message', 'generation/finished', 'turn/finished'].includes(event.type))
    setPartial('');
  if (
    event.type.endsWith('/message') ||
    event.type.endsWith('/accepted') ||
    event.type.endsWith('/finished') ||
    event.type.endsWith('/started') ||
    event.type.startsWith('question/') ||
    event.type.startsWith('approval/') ||
    event.type === 'permission/changed' ||
    event.type === 'tool/intent' ||
    event.type === 'tool/result'
  )
    void refresh().catch(fail);
  if (event.type.endsWith('/finished')) void reloadLists().catch(fail);
}

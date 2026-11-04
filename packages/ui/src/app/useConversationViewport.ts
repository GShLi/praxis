import { useEffect } from 'react';
import type { ConversationState } from './useConversationState.ts';
import type { SettingsTab } from '../navigation-state.ts';

export function useConversationViewport(
  {
    input,
    selected,
    follow,
    scroll,
    snapshot,
    partial,
    question,
  }: Pick<
    ConversationState,
    'input' | 'selected' | 'follow' | 'scroll' | 'snapshot' | 'partial' | 'question'
  >,
  draft: string,
  settings: SettingsTab | null,
) {
  useEffect(() => {
    const field = input.current;
    if (field) {
      field.style.height = 'auto';
      field.style.height = `${Math.min(field.scrollHeight, 200)}px`;
    }
  }, [draft, settings, selected]);
  useEffect(() => {
    if (follow) scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'auto' });
  }, [snapshot?.messages.length, partial, follow, question]);
}

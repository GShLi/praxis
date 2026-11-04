import type { KeyboardEvent, RefObject } from 'react';
import type { DropdownOption } from './dropdown-types.ts';

export function dropdownKeyDown(
  event: KeyboardEvent,
  options: readonly DropdownOption[],
  active: string | undefined,
  highlight: (value: string) => void,
  choose: (value: string) => void,
  close: (restore?: boolean) => void,
  typed: RefObject<{ text: string; time: number }>,
) {
  if (event.nativeEvent.isComposing) return;
  const key = event.key;
  if (key === 'Tab') {
    close(false);
    return;
  }
  if (key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    close();
    return;
  }
  const enabled = options.filter((option) => !option.disabled);
  const index = enabled.findIndex((option) => option.value === active);
  const searching = event.target instanceof HTMLInputElement;
  if (
    ['ArrowDown', 'ArrowUp', 'Enter'].includes(key) ||
    (!searching && ['Home', 'End', ' '].includes(key))
  ) {
    event.preventDefault();
    event.stopPropagation();
    if (key === 'Enter' || key === ' ') {
      if (active !== undefined) choose(active);
      return;
    }
    const next =
      key === 'Home'
        ? 0
        : key === 'End'
          ? enabled.length - 1
          : (index + (key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
    if (enabled[next]) highlight(enabled[next].value);
  } else if (!searching && key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    const now = Date.now();
    typed.current = {
      text: (now - typed.current.time < 700 ? typed.current.text : '') + key,
      time: now,
    };
    const next = enabled.find((option) =>
      option.label.toLocaleLowerCase().startsWith(typed.current.text.toLocaleLowerCase()),
    );
    if (next) highlight(next.value);
  }
}

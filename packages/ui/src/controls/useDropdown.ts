import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { DropdownProps } from './dropdown-types.ts';
import { trackDropdownPosition } from './dropdown-position.ts';
import { dropdownKeyDown } from './dropdown-keyboard.ts';
import { dropdownGroups } from './dropdown-groups.ts';

export function useDropdown(props: DropdownProps) {
  const trigger = useRef<HTMLButtonElement>(null),
    popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState(props.value);
  const typed = useRef({ text: '', time: 0 });
  const groups = dropdownGroups(props.options, query);
  const options = groups.flatMap((group) => group.options);
  const active =
    options.find((option) => option.value === activeId && !option.disabled) ??
    options.find((option) => !option.disabled);
  const close = (restore = true) => {
    if (popup.current?.matches(':popover-open')) popup.current.hidePopover();
    setOpen(false);
    if (restore) trigger.current?.focus();
  };
  const choose = (value: string) => {
    if (
      props.disabled ||
      trigger.current?.matches(':disabled') ||
      !options.some((option) => option.value === value && !option.disabled)
    )
      return;
    props.onChange(value);
    close();
  };
  const show = () => {
    if (props.disabled || trigger.current?.matches(':disabled')) return;
    setQuery('');
    setActiveId(props.value);
    typed.current = { text: '', time: 0 };
    popup.current?.showPopover();
    setOpen(true);
  };
  useDropdownLifecycle({ trigger, popup, open, disabled: props.disabled });
  useEffect(() => {
    popup.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active?.value, open]);
  return {
    trigger,
    popup,
    open,
    setOpen,
    query,
    setQuery,
    options,
    groups,
    active,
    show,
    close,
    choose,
    keyDown: (event: KeyboardEvent) =>
      dropdownKeyDown(event, options, active?.value, setActiveId, choose, close, typed),
  };
}

function useDropdownLifecycle({
  trigger,
  popup,
  open,
  disabled,
}: {
  trigger: React.RefObject<HTMLButtonElement | null>;
  popup: React.RefObject<HTMLDivElement | null>;
  open: boolean;
  disabled?: boolean | undefined;
}) {
  useEffect(() => {
    if (!open || !popup.current || !trigger.current) return;
    const menu = popup.current,
      button = trigger.current;
    if (disabled || button.matches(':disabled')) {
      menu.hidePopover();
      return;
    }
    const stop = trackDropdownPosition(button, menu);
    menu.querySelector<HTMLElement>('input, [role="listbox"]')?.focus({ preventScroll: true });
    const fieldset = button.closest('fieldset');
    const observer = new MutationObserver(() => {
      if (button.matches(':disabled') && menu.matches(':popover-open')) menu.hidePopover();
    });
    if (fieldset) observer.observe(fieldset, { attributes: true, attributeFilter: ['disabled'] });
    return () => {
      observer.disconnect();
      stop();
    };
  }, [open, disabled, trigger, popup]);
}

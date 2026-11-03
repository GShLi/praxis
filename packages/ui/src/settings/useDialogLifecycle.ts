import { useEffect, useRef, type RefObject } from 'react';

export function useDialogLifecycle(
  dialog: RefObject<HTMLDialogElement | null>,
  dirty: boolean,
  busy: boolean,
  requestClose: () => void,
) {
  const current = useRef({ dirty, busy, requestClose });
  current.current = { dirty, busy, requestClose };
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement;
    element.showModal();
    element.querySelector<HTMLElement>('[data-dialog-focus]')?.focus();
    const unload = (event: BeforeUnloadEvent) => {
      if (current.current.dirty || current.current.busy) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const navigate = (event: Event) => {
      event.preventDefault();
      current.current.requestClose();
    };
    window.addEventListener('beforeunload', unload);
    window.addEventListener('praxis:before-navigate', navigate);
    return () => {
      element.close();
      window.removeEventListener('beforeunload', unload);
      window.removeEventListener('praxis:before-navigate', navigate);
      queueMicrotask(() => {
        if (previous instanceof HTMLElement) {
          const target = previous.isConnected ? previous : document.getElementById(previous.id);
          target?.focus();
        }
      });
    };
  }, []);
}

import { useEffect, useRef, useState } from 'react';
import { protectUnsavedForm } from './unsaved-form.ts';

export function useUnsavedForm(dirty: boolean, busy: boolean) {
  const current = useRef({ dirty, busy });
  current.current = { dirty, busy };
  const [pending, setPending] = useState<{ proceed: () => void } | null>(null);
  const confirm = (proceed: () => void) => setPending((value) => value ?? { proceed });
  useEffect(() => protectUnsavedForm(window, () => current.current, confirm), []);
  return {
    pending: Boolean(pending),
    request: (proceed: () => void) => {
      if (current.current.busy) return;
      if (current.current.dirty) confirm(proceed);
      else proceed();
    },
    cancel: () => setPending(null),
    discard: () => {
      if (current.current.busy) return;
      setPending(null);
      pending?.proceed();
    },
  };
}

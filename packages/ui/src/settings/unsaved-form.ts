export interface UnsavedFormState {
  dirty: boolean;
  busy: boolean;
}

/** Installs one form's navigation and reload boundary; the caller owns confirmation UI. */
export function protectUnsavedForm(
  target: EventTarget,
  current: () => UnsavedFormState,
  confirm: (proceed: () => void) => void,
) {
  const navigate = (event: Event) => {
    if (event.defaultPrevented) return;
    const { dirty, busy } = current();
    if (!dirty && !busy) return;
    event.preventDefault();
    if (busy) return;
    const detail: unknown = 'detail' in event ? event.detail : undefined;
    if (
      typeof detail === 'object' &&
      detail !== null &&
      'proceed' in detail &&
      typeof detail.proceed === 'function'
    ) {
      const proceed = detail.proceed;
      confirm(() => {
        proceed();
      });
    }
  };
  const unload = (event: Event) => {
    const { dirty, busy } = current();
    if (dirty || busy) {
      event.preventDefault();
      (event as BeforeUnloadEvent).returnValue = '';
    }
  };
  target.addEventListener('praxis:before-navigate', navigate);
  target.addEventListener('beforeunload', unload);
  return () => {
    target.removeEventListener('praxis:before-navigate', navigate);
    target.removeEventListener('beforeunload', unload);
  };
}

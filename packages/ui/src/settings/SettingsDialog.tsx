import { useId, useRef, useState, type ReactNode } from 'react';
import { useDialogLifecycle } from './useDialogLifecycle.ts';

export function SettingsDialog({
  title,
  dirty = false,
  busy = false,
  close,
  children,
}: {
  title: string;
  dirty?: boolean;
  busy?: boolean;
  close: () => void;
  children: (requestClose: () => void) => ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    titleId = useId();
  const [discard, setDiscard] = useState(false);
  const requestClose = () => {
    if (!busy) {
      if (dirty) setDiscard(true);
      else close();
    }
  };
  useDialogLifecycle(dialog, dirty, busy, requestClose);
  return (
    <dialog
      ref={dialog}
      className="settings-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          requestClose();
      }}
    >
      <header className="dialog-heading">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="关闭弹窗"
          disabled={busy}
          onClick={requestClose}
        >
          ×
        </button>
      </header>
      {discard ? (
        <section className="dialog-discard" role="alert">
          <h3>放弃未保存的修改？</h3>
          <p>你的修改尚未保存，关闭后将丢失。</p>
          <div className="settings-form-footer">
            <button autoFocus className="secondary-button" onClick={() => setDiscard(false)}>
              继续编辑
            </button>
            <button className="danger-button" onClick={close}>
              放弃修改
            </button>
          </div>
        </section>
      ) : (
        children(requestClose)
      )}
    </dialog>
  );
}

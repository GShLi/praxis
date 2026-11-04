import { useEffect, useRef, useState } from 'react';

/** The credential editor owns its secret and invalidates results when its server changes. */
export function useMcpCredential(
  serverId: string,
  save: (token: string) => Promise<boolean>,
  clear: () => Promise<boolean>,
) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    return () => {
      generation.current++;
    };
  }, [serverId]);
  const submit = () => {
    const current = generation.current;
    void save(token)
      .then((saved) => {
        if (saved && current === generation.current) setOpen(false);
      })
      .finally(() => {
        if (current === generation.current) setToken('');
      });
  };
  const remove = () => {
    setToken('');
    const current = generation.current;
    void clear().then((done) => {
      if (done && current === generation.current) setOpen(false);
    });
  };
  const cancel = () => {
    setToken('');
    setOpen(false);
  };
  return { open, setOpen, token, setToken, submit, remove, cancel };
}

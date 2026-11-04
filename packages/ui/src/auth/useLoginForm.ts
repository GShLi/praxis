import { useEffect, useRef, useState, type FormEvent } from 'react';

export interface LoginInput {
  username: string;
  password: string;
  serverUrl: string;
  apiKey: string;
}

/** Only an explicit true clears secrets; false/void retain them for a retry. */
export type LoginSubmit = (input: LoginInput) => Promise<boolean | void>;

export function useLoginForm(onSubmit: LoginSubmit) {
  const [values, setValues] = useState<LoginInput>({
    username: '',
    password: '',
    serverUrl: 'http://127.0.0.1:4310',
    apiKey: '',
  });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function update(field: keyof LoginInput, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setFailure('');
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailure('');
    try {
      const success = await onSubmit(values);
      if (success === true && mounted.current)
        setValues((current) => ({ ...current, password: '', apiKey: '' }));
    } catch {
      // Transport errors may contain credentials; show a fixed local fallback.
      if (mounted.current) setFailure('连接失败，请检查登录信息和网络后重试。输入已保留。');
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return { values, update, busy, failure, submit };
}

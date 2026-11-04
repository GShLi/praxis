import { useEffect, useRef, useState } from 'react';
import type { PluginReview, PraxisClient } from '../client-types.ts';
import { errorText } from './controls.tsx';
import type { SettingsFeedback } from './settings-resource.ts';

export function usePluginEditor(client: PraxisClient) {
  const [source, setSource] = useState('');
  const [review, setReview] = useState<PluginReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<SettingsFeedback>({ message: '', variant: 'info' });
  const scope = useRef({ active: false, busy: false });
  useEffect(() => {
    const current = { active: true, busy: false };
    scope.current = current;
    setSource('');
    setReview(null);
    setBusy(false);
    setFeedback({ message: '', variant: 'info' });
    return () => {
      current.active = false;
    };
  }, [client]);
  const changeSource = (value: string) => {
    if (scope.current.busy) return;
    setSource(value);
    setReview(null);
    setFeedback({ message: '', variant: 'info' });
  };
  const run = async (action: () => Promise<() => void>) => {
    const current = scope.current;
    if (!current.active || current.busy) return;
    current.busy = true;
    setBusy(true);
    setFeedback({ message: '', variant: 'info' });
    try {
      const apply = await action();
      if (current.active) apply();
    } catch (error) {
      if (current.active) setFeedback({ message: errorText(error), variant: 'error' });
    } finally {
      current.busy = false;
      if (current.active) setBusy(false);
    }
  };
  return {
    source,
    review,
    busy,
    feedback,
    changeSource,
    choose: () =>
      run(async () => {
        if (!client.selectPluginDirectory)
          throw new Error('此客户端不支持选择插件目录，请手动填写。');
        const selected = await client.selectPluginDirectory();
        return () => {
          if (selected !== null) {
            setSource(selected);
            setReview(null);
          }
        };
      }),
    inspect: () =>
      run(async () => {
        setReview(null);
        if (!client.inspectPlugin) throw new Error('此客户端不支持检查插件。');
        const result = await client.inspectPlugin(source);
        return () => {
          setReview(result);
          setFeedback({
            message: '包内容已检查。请核对声明能力和来源后决定是否信任并安装。',
            variant: 'success',
          });
        };
      }),
    install: (save: (source: string, digest: string) => Promise<boolean>, close: () => void) =>
      run(async () => {
        if (!review) throw new Error('请先检查包内容。');
        const saved = await save(source, review.digest);
        return () => {
          if (saved) close();
        };
      }),
  };
}

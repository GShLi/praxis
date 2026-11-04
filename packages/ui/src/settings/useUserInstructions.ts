import {
  userInstructionSettingsSchema,
  saveUserInstructionsSchema,
  type UserInstructionSettings,
} from '@praxis/contracts';
import { useEffect, useRef, useState } from 'react';
import type { PraxisClient } from '../client-types.ts';
import { errorText } from './controls.tsx';
import type { FeedbackVariant } from './settings-resource.ts';

export function useUserInstructions(client: PraxisClient) {
  const [saved, setSaved] = useState<UserInstructionSettings | null>(null);
  const [draft, setDraft] = useState({ enabled: false, text: '' });
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [variant, setVariant] = useState<FeedbackVariant>('info');
  const [operation, setOperation] = useState<'load' | 'save' | null>(null);
  const dirty = Boolean(
    saved && (saved.value.enabled !== draft.enabled || saved.value.text !== draft.text),
  );
  const scope = useRef({ active: false, busy: false });
  const apply = (raw: unknown) => {
    const value = userInstructionSettingsSchema.parse(raw);
    setSaved(value);
    setDraft(value.value);
  };
  async function load() {
    const current = scope.current;
    if (!current.active || current.busy || !client.userInstructions) return;
    current.busy = true;
    setBusy(true);
    setOperation('load');
    setMessage('');
    try {
      const value = await client.userInstructions();
      if (current.active) {
        apply(value);
        setVariant('success');
        setMessage('已读取保存的版本。');
      }
    } catch (error) {
      if (current.active) {
        setVariant('error');
        setMessage(errorText(error));
      }
    } finally {
      current.busy = false;
      if (current.active) {
        setBusy(false);
        setOperation(null);
      }
    }
  }
  useEffect(() => {
    const current = { active: true, busy: false };
    scope.current = current;
    setSaved(null);
    setDraft({ enabled: false, text: '' });
    setBusy(false);
    setOperation(null);
    setMessage('');
    setVariant('info');
    void load();
    return () => {
      current.active = false;
    };
  }, [client]);
  async function save() {
    const current = scope.current;
    if (!current.active || current.busy || !saved || !client.saveUserInstructions) return;
    current.busy = true;
    setBusy(true);
    setOperation('save');
    setMessage('');
    try {
      const input = saveUserInstructionsSchema.parse({
        expectedRevision: saved.revision,
        value: draft,
      });
      const result = await client.saveUserInstructions(input);
      if (current.active) {
        apply(result);
        setVariant('success');
        setMessage('已保存，从下一次任务或回复开始生效。');
      }
    } catch (error) {
      if (current.active) {
        setVariant('error');
        setMessage(errorText(error));
      }
    } finally {
      current.busy = false;
      if (current.active) {
        setBusy(false);
        setOperation(null);
      }
    }
  }
  const edit = (value: typeof draft) => {
    setDraft(value);
    setMessage('');
  };
  return { saved, draft, setDraft: edit, dirty, busy, operation, variant, message, load, save };
}

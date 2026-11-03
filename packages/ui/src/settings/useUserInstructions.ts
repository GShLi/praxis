import {
  userInstructionSettingsSchema,
  saveUserInstructionsSchema,
  type UserInstructionSettings,
} from '@praxis/contracts';
import { useEffect, useRef, useState } from 'react';
import type { PraxisClient } from '../client-types.ts';
import { errorText } from './controls.tsx';

export function useUserInstructions(client: PraxisClient) {
  const [saved, setSaved] = useState<UserInstructionSettings | null>(null);
  const [draft, setDraft] = useState({ enabled: false, text: '' });
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
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
    setMessage('');
    try {
      const value = await client.userInstructions();
      if (current.active) apply(value);
    } catch (error) {
      if (current.active) setMessage(errorText(error));
    } finally {
      current.busy = false;
      if (current.active) setBusy(false);
    }
  }
  useEffect(() => {
    const current = { active: true, busy: false };
    scope.current = current;
    setSaved(null);
    setDraft({ enabled: false, text: '' });
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
    setMessage('');
    try {
      const input = saveUserInstructionsSchema.parse({
        expectedRevision: saved.revision,
        value: draft,
      });
      const result = await client.saveUserInstructions(input);
      if (current.active) {
        apply(result);
        setMessage('已保存，从下一次任务或回复开始生效。');
      }
    } catch (error) {
      if (current.active) setMessage(errorText(error));
    } finally {
      current.busy = false;
      if (current.active) setBusy(false);
    }
  }
  return { saved, draft, setDraft, busy, message, load, save };
}

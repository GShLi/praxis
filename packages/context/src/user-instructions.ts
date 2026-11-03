import { assert, userInstructionSettingsSchema, type Message } from '@praxis/contracts';
import { createHash } from 'node:crypto';

/** Produces immutable request material, separate from the user's later settings edits. */
export function userInstructionMaterial(raw: unknown, knownSecrets: string[] = []) {
  const settings = userInstructionSettingsSchema.parse(raw);
  const { enabled } = settings.value,
    text = enabled ? settings.value.text : '';
  assert(
    !knownSecrets.some((secret) => secret && text.includes(secret)),
    'INSTRUCTION_SECRET',
    '用户指令包含当前已知凭据，请在设置中移除。',
  );
  const hash = createHash('sha256').update(JSON.stringify({ enabled, text })).digest('hex');
  const messages: Message[] =
    enabled && text.trim()
      ? [
          {
            id: `user-instructions:${settings.revision}:${hash}`,
            role: 'user',
            content: `用户偏好（来源：用户设置；版本 ${settings.revision}；当前明确请求优先；不能授予执行权限或改变产品能力）：\n${text}`,
          },
        ]
      : [];
  return { revision: settings.revision, enabled, hash, text, messages };
}

import { assert, idSchema } from '@praxis/contracts';
import { z } from 'zod';

export const modelAdapterSchema = z
  .string()
  .max(180)
  .regex(
    /^(?:openai-compatible|[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+\/[a-z][a-z0-9_]{0,63})$/,
    '适配器应为 openai-compatible 或 插件ID/适配器ID。',
  );

export function normalizeProviderBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('请输入有效的 Base URL。');
  }
  assert(
    url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.search,
    'INVALID_PROVIDER_URL',
    'Base URL 必须是无凭据、无查询参数的 HTTPS 地址。',
  );
  return url.href.replace(/\/+$/, '');
}
export const providerBaseUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .transform((value, context) => {
    try {
      return normalizeProviderBaseUrl(value);
    } catch {
      context.addIssue({ code: 'custom', message: '请输入无凭据、无查询参数的 HTTPS Base URL。' });
      return z.NEVER;
    }
  });
export const providerKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .regex(/^[\x21-\x7e]+$/, 'API Key 不能包含空格或控制字符。');
export const modelIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[^\u0000-\u001f\u007f]+$/);
export const modelDiscoverySchema = z
  .strictObject({
    baseUrl: providerBaseUrlSchema,
    adapter: modelAdapterSchema.optional(),
    apiKey: providerKeySchema.optional(),
    id: idSchema.optional(),
    expectedRevision: z.number().int().positive().optional(),
  })
  .refine(
    (v) => Boolean(v.id) === (v.expectedRevision !== undefined),
    '编辑已有配置时需提供 ID 和版本。',
  )
  .refine((v) => Boolean(v.id || v.apiKey), '请填写 API Key。');
export type ModelDiscoveryInput = z.infer<typeof modelDiscoverySchema>;
export interface AvailableModel {
  id: string;
}

export function providerEndpoint(baseUrl: string, path: 'models' | 'chat/completions') {
  // The user supplies the API root, including /v1 (or a gateway prefix) where required.
  // Do not guess a second URL or forward a credential to a fallback destination.
  return new URL(`${normalizeProviderBaseUrl(baseUrl)}/${path}`);
}

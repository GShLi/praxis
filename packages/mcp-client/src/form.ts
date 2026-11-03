import { assert } from '@praxis/contracts';
import { formQuestions, convertFormAnswer } from './form-fields.ts';
import { compileSchema, type JsonSchema } from '@praxis/schema';
import type { Ask } from '@praxis/tools';
import { z } from 'zod';
const formSchema = z.object({
  mode: z.literal('form').optional(),
  message: z.string().max(4096),
  requestedSchema: z.unknown(),
});
const forbidden =
  /(api.?key|access.?token|refresh.?token|password|passwd|secret|credential|credit.?card|cvv|密钥|密码|验证码|银行卡)/i;
export function containsSecret(value: unknown, secrets: readonly string[]) {
  const serialized = JSON.stringify(value) ?? '';
  return secrets.some(
    (secret) => secret && serialized.includes(JSON.stringify(secret).slice(1, -1)),
  );
}
export function prepareForm(
  raw: unknown,
  source: { server: string; inputId: string },
  secrets: readonly string[],
) {
  const parsed = formSchema.safeParse(raw);
  assert(parsed.success, 'MCP_FORM_UNSUPPORTED', '仅支持文本表单，不支持 URL 或其他交互类型。');
  const compiled = compileSchema(parsed.data.requestedSchema);
  const schema = compiled.schema;
  assert(
    schema.type === 'object' &&
      schema.properties &&
      typeof schema.properties === 'object' &&
      !Array.isArray(schema.properties),
    'MCP_FORM_UNSUPPORTED',
    '表单必须包含对象属性。',
  );
  const fields = Object.entries(schema.properties as Record<string, JsonSchema>);
  assert(fields.length > 0 && fields.length <= 12, 'MCP_INPUT_LIMIT', '每轮最多 12 个表单字段。');
  assert(
    !containsSecret(raw, secrets) &&
      !forbidden.test(parsed.data.message) &&
      fields.every(
        ([name, field]) =>
          !forbidden.test(
            name + ' ' + String(field.title ?? '') + ' ' + String(field.description ?? ''),
          ),
      ),
    'MCP_SECRET_FORM_DENIED',
    'MCP 表单不能收集密钥、密码或支付秘密。',
  );
  const questions = formQuestions(fields, source, parsed.data.message);
  const convert = (raw: unknown) => {
    assert(!containsSecret(raw, secrets), 'MCP_SECRET_DENIED', '回答包含已知凭据，未保存或发送。');
    const result = convertFormAnswer(raw, fields, schema);
    if (result.action === 'decline') return result;
    const { content } = result;
    compiled.validate(content);
    assert(
      !containsSecret(content, secrets),
      'MCP_SECRET_DENIED',
      '回答包含已知凭据，未保存或发送。',
    );
    return { action: 'accept' as const, content };
  };
  return { questions, convert, fieldCount: fields.length };
}
export async function answerForm(
  form: ReturnType<typeof prepareForm>,
  ask: Ask,
  signal: AbortSignal,
) {
  const answer = await ask(form.questions, signal, (value) => {
    form.convert(value);
  });
  signal.throwIfAborted();
  return form.convert(answer);
}

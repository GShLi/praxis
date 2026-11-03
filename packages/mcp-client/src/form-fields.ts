import { assert, answersSchema, questionSchema, type QuestionAnswer } from '@praxis/contracts';
import type { JsonSchema } from '@praxis/schema';
import { z } from 'zod';
type Fields = Array<[string, JsonSchema]>;
function values(field: JsonSchema) {
  return Array.isArray(field.enum)
    ? field.enum
    : field.type === 'boolean'
      ? [true, false]
      : undefined;
}
function display(text: string) {
  return text.replace(
    /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}
export function formQuestions(
  fields: Fields,
  source: { server: string; inputId: string },
  message: string,
) {
  return fields.map(([name, field], index) => {
    assert(
      ['string', 'number', 'integer', 'boolean', 'array'].includes(String(field.type ?? 'string')),
      'MCP_FORM_UNSUPPORTED',
      '表单不支持嵌套对象字段。',
    );
    const choices = values(field);
    const options =
      choices && choices.length >= 2 && choices.length <= 10
        ? choices.map((value, index) => ({ id: String(index), label: display(String(value)) }))
        : undefined;
    const prompt = display(
      `MCP ${source.server} · ${source.inputId}\n${message}\n字段：${name}\n约束：${JSON.stringify(field)}\n回答将发送给该服务器；跳过必填项表示拒绝此表单。数组请填 JSON。`,
    );
    return questionSchema.parse({ id: `field-${index}`, prompt, ...(options ? { options } : {}) });
  });
}
function answerValue(answer: QuestionAnswer, field: JsonSchema) {
  let value: unknown =
    answer.selectedOptionId !== undefined
      ? values(field)?.[Number(answer.selectedOptionId)]
      : answer.text;
  if (
    answer.selectedOptionId === undefined &&
    field.type !== 'string' &&
    field.type !== undefined
  ) {
    try {
      value = JSON.parse(String(value));
    } catch {
      assert(false, 'INVALID_ARGUMENT', '请按字段类型填写有效 JSON 值。');
    }
  }
  assert(
    typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      (Array.isArray(value) && value.every((v) => typeof v === 'string')),
    'INVALID_ARGUMENT',
    '字段值类型无效。',
  );
  return value;
}
export function convertFormAnswer(raw: unknown, fields: Fields, schema: JsonSchema) {
  const answers = answersSchema.parse(z.object({ answers: z.unknown() }).parse(raw).answers);
  assert(
    answers.length === fields.length && new Set(answers.map((a) => a.id)).size === answers.length,
    'INVALID_ARGUMENT',
    '请回答表单的全部字段。',
  );
  const content: Record<string, string | number | boolean | string[]> = Object.create(null);
  for (const [index, [name, field]] of fields.entries()) {
    const answer = answers.find((a) => a.id === `field-${index}`);
    assert(answer, 'INVALID_ARGUMENT', '表单字段 ID 无效。');
    if (answer.skipped) {
      if (Array.isArray(schema.required) && schema.required.includes(name))
        return { action: 'decline' as const };
      continue;
    }
    content[name] = answerValue(answer, field);
  }
  return { action: 'accept' as const, content };
}

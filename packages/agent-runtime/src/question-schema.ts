import { assert, answersSchema, type QuestionAnswer } from '@praxis/contracts';
import type { Ask } from '@praxis/tools';
export { answersSchema };
export function validateAnswers(questions: Parameters<Ask>[0], answers: QuestionAnswer[]) {
  assert(
    answers.length === questions.length &&
      new Set(answers.map((a) => a.id)).size === answers.length,
    'INVALID_ARGUMENT',
    '请为每个问题提供一个回答或跳过。',
  );
  for (const answer of answers) {
    const question = questions.find((q) => q.id === answer.id);
    assert(question, 'INVALID_ARGUMENT', '问题 ID 无效。');
    if (answer.selectedOptionId)
      assert(
        question.options?.some((o) => o.id === answer.selectedOptionId),
        'INVALID_ARGUMENT',
        '选项 ID 无效。',
      );
    assert(
      answer.skipped || answer.selectedOptionId || answer.text?.trim(),
      'INVALID_ARGUMENT',
      '请选择、填写或明确跳过。',
    );
  }
}

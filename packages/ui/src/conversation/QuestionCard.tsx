import { useState } from 'react';

import type { Question } from './types.ts';

export function QuestionCard({
  question,
  submit,
}: {
  question: Question;
  submit: (answers: unknown) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({}),
    [choices, setChoices] = useState<Record<string, string | undefined>>({}),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="question-card"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        void submit(
          question.questions.map((q) => ({
            id: q.id,
            ...(choices[q.id] !== undefined
              ? { selectedOptionId: choices[q.id] }
              : { text: answers[q.id] ?? '' }),
            skipped: !answers[q.id]?.trim(),
          })),
        ).finally(() => setBusy(false));
      }}
    >
      <h3>需要你的补充</h3>
      {question.questions.map((q) => (
        <label key={q.id}>
          {q.prompt}
          {q.options && (
            <div className="question-options">
              {q.options.map((o) => (
                <button
                  type="button"
                  key={o.id}
                  onClick={() => {
                    setAnswers({ ...answers, [q.id]: o.label });
                    setChoices({ ...choices, [q.id]: o.id });
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
          <input
            value={answers[q.id] ?? ''}
            onChange={(e) => {
              setAnswers({ ...answers, [q.id]: e.target.value });
              setChoices({ ...choices, [q.id]: undefined });
            }}
            placeholder="填写回答；留空表示跳过"
          />
        </label>
      ))}
      <button className="primary-button" disabled={busy}>
        提交回答
      </button>
    </form>
  );
}

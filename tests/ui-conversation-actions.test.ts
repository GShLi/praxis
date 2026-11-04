import assert from 'node:assert/strict';
import test from 'node:test';
import type { SetStateAction } from 'react';
import type { PendingQuestion } from '@praxis/ui/client';
import { approval, event, snapshot } from './task-presentation-fixtures.ts';

const { messageActions } = await import(
  new URL('../packages/ui/src/conversation/message-actions.ts', import.meta.url).href
);
const { projectConversationEvent } = await import(
  new URL('../packages/ui/src/app/conversation-events.ts', import.meta.url).href
);

const question: PendingQuestion = { questionId: 'question', turnId: 'turn', questions: [] };

test('message actions preserve approval identity and propagate approval failure to the card', async () => {
  const sent: unknown[] = [];
  const actions = messageActions(
    { respondApproval: async (input: unknown) => sent.push(input) },
    'selected',
    { ...snapshot(), approval: approval() },
    null,
    () => {},
    () => {},
  );
  await actions.approve('deny');
  assert.deepEqual(sent, [
    {
      sessionId: 'session',
      turnId: 'turn',
      approvalId: 'approval',
      requestHash: 'request',
      decision: 'deny',
    },
  ]);
  const failed = messageActions(
    {
      respondApproval: async () => {
        throw new Error('rejected');
      },
    },
    'selected',
    { ...snapshot(), approval: approval() },
    null,
    () => {},
    () => {},
  );
  await assert.rejects(failed.approve('approve-once'), /rejected/);
});

test('question answers forward the unknown payload and clear the card only on success', async () => {
  const updates: unknown[] = [],
    errors: unknown[] = [],
    sent: unknown[] = [];
  let rejected = true;
  const actions = messageActions(
    {
      answer: async (input: unknown) => {
        sent.push(input);
        if (rejected) throw new Error('retry');
      },
    },
    'selected',
    snapshot(),
    question,
    (value: unknown) => updates.push(value),
    (error: unknown) => errors.push(error),
  );
  const answers = [{ id: 'choice', selectedOptionId: 'yes', skipped: false }];
  await actions.answer(answers);
  assert.equal(errors.length, 1);
  assert.deepEqual(updates, []);
  rejected = false;
  await actions.answer(answers);
  assert.deepEqual(updates, [null]);
  assert.deepEqual(sent[1], {
    sessionId: 'selected',
    questionId: 'question',
    turnId: 'turn',
    answers,
  });
});

function projection() {
  const state = {
    question: question as PendingQuestion | null,
    partial: 'stream',
    error: '',
    refreshes: 0,
    lists: 0,
    errors: [] as unknown[],
  };
  const handlers = {
    setQuestion(update: SetStateAction<PendingQuestion | null>) {
      state.question = typeof update === 'function' ? update(state.question) : update;
    },
    setPartial(value: string) {
      state.partial = value;
    },
    setError(value: string) {
      state.error = value;
    },
    async refresh() {
      state.refreshes++;
    },
    async reloadLists() {
      state.lists++;
    },
    fail(error: unknown) {
      state.errors.push(error);
    },
  };
  const send = (type: string, payload: Record<string, unknown> = {}) =>
    projectConversationEvent(event(type, 1, '2020-01-01T00:00:00Z', payload), handlers);
  return { state, handlers, send };
}

test('event projection matches question and turn IDs and refreshes the relevant views', () => {
  const { state, send } = projection();
  send('question/answered', { questionId: 'older' });
  assert.equal(state.question, question);
  send('turn/finished', { turnId: 'older' });
  assert.equal(state.question, question);
  assert.equal(state.partial, '');
  assert.equal(state.lists, 1);
  send('question/closed', { questionId: 'question' });
  assert.equal(state.question, null);
  send('question/asked', { ...question });
  assert.deepEqual(state.question, question);
  send('turn/finished');
  assert.equal(state.question, null);
  send('generation/error', { safeMessage: 'safe error' });
  assert.equal(state.error, 'safe error');
  assert.equal(state.refreshes, 5);
  assert.equal(state.lists, 2);
});

test('event refresh failures reach the existing error owner', async () => {
  const { state, handlers, send } = projection();
  handlers.refresh = async () => {
    throw new Error('snapshot unavailable');
  };
  handlers.reloadLists = async () => {
    throw new Error('list unavailable');
  };
  send('turn/finished');
  await Promise.resolve();
  assert.equal(state.errors.length, 2);
});

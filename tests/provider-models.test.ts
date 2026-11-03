import assert from 'node:assert/strict';
import test from 'node:test';
import { providerInputSchema } from '@praxis/auth';
import { providerModelChoices } from '@praxis/model-core/provider-models';

const legacy = {
  name: 'Fixture',
  baseUrl: 'https://provider.invalid',
  model: 'chat',
  contextWindow: 128000,
  maxOutputTokens: 4096,
  enabled: true,
};
const primary = {
  id: 'default',
  model: 'chat',
  contextWindow: 128000,
  maxOutputTokens: 4096,
  enabled: true,
};
const secondary = { ...primary, id: 'reasoning', model: 'reasoner' };

test('a provider accepts multiple independently configured models and legacy input', () => {
  assert.equal(providerInputSchema.parse(legacy).model, 'chat');
  const parsed = providerInputSchema.parse({ ...legacy, models: [primary, secondary] });
  assert.equal(parsed.models?.length, 2);
});

test('provider model collections reject ambiguous IDs, invalid budgets and inconsistent defaults', () => {
  for (const models of [
    [primary, primary],
    [primary, { ...secondary, model: 'chat' }],
    [secondary],
    [primary, { ...secondary, maxOutputTokens: 100000 }],
    [{ ...primary, model: 'different' }],
  ])
    assert.equal(providerInputSchema.safeParse({ ...legacy, models }).success, false);
});

test('model choices keep legacy IDs and allow enabled secondary models when the primary is disabled', () => {
  const choices = providerModelChoices([
    { ...legacy, id: 'legacy' },
    { ...legacy, id: 'multi', models: [{ ...primary, enabled: false }, secondary] },
    { ...legacy, id: 'disabled', enabled: false, models: [primary, secondary] },
  ]);
  assert.deepEqual(
    choices.filter((m) => m.enabled).map((m) => [m.id, m.model]),
    [
      ['legacy', 'chat'],
      ['multi:reasoning', 'reasoner'],
    ],
  );
  const customDefault = providerModelChoices([
    { ...legacy, id: 'custom', defaultModelId: 'reasoning', models: [secondary] },
  ]);
  assert.equal(customDefault[0]?.id, 'custom');
  assert.equal(customDefault[0]?.model, 'reasoner');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { mcpExecutor } from './fixtures/mcp-executor.ts';

test('unused answer text cannot smuggle a known credential into a saved choice response', async () => {
  const f = await mcpExecutor(false, false, async (items, _signal, validate) => {
    const answer = {
      answers: items.map((q) => ({
        id: q.id,
        selectedOptionId: '0',
        text: 'fixture-model-secret',
        skipped: false,
      })),
    };
    validate?.(answer);
    return answer;
  });
  try {
    f.remote.inputRequired = true;
    f.remote.form = {
      type: 'object',
      properties: { city: { type: 'string', enum: ['Shanghai', 'Beijing'] } },
    };
    assert.equal(
      (await f.execute(await f.select(), { text: 'test' })).error?.code,
      'MCP_SECRET_DENIED',
    );
    assert.equal(f.requests.filter((r) => r.method === 'tools/call').length, 1);
  } finally {
    await f.close();
  }
});

test('state-only MCP continuation works without a human channel and keeps the same round limit', async () => {
  const f = await mcpExecutor();
  try {
    f.remote.inputRequired = true;
    f.remote.stateOnly = true;
    const name = await f.select();
    assert.equal((await f.execute(name, { text: 'continue' })).status, 'succeeded');
    assert.equal(f.requests.filter((r) => r.method === 'tools/call').length, 2);
    f.remote.repeatInput = true;
    assert.equal((await f.execute(name, { text: 'loop' })).error?.code, 'MCP_INPUT_LIMIT');
    assert.equal(f.store.events(f.session.id).filter((e) => e.type === 'question/asked').length, 0);
  } finally {
    await f.close();
  }
});

test('legacy servers cannot turn a rejected secret request into a successful business result', async () => {
  let asked = false;
  const f = await mcpExecutor(true, false, async () => {
    asked = true;
    return {};
  });
  try {
    f.remote.inputRequired = true;
    f.remote.form = { type: 'object', properties: { password: { type: 'string' } } };
    const result = await f.execute(await f.select(), { text: 'test' });
    assert.equal(result.error?.code, 'MCP_SECRET_FORM_DENIED');
    assert.equal(asked, false);
  } finally {
    await f.close();
  }
});

test('MCP form continuation is bounded, uses fresh request IDs, and never persists opaque request state', async () => {
  let questions = 0;
  const f = await mcpExecutor(false, false, async (items, _signal, validate) => {
    questions++;
    assert.match(items[0]!.prompt, /Local fixture/);
    const answer = {
      questionId: 'fixture',
      answers: items.map((item) => ({ id: item.id, text: 'Shanghai', skipped: false })),
    };
    validate?.(answer);
    return answer;
  });
  try {
    f.remote.inputRequired = true;
    const name = await f.select();
    const result = await f.execute(name, { text: 'travel' });
    assert.equal(result.status, 'succeeded');
    assert.equal(questions, 1);
    const calls = f.requests.filter((r) => r.method === 'tools/call');
    assert.equal(calls.length, 2);
    assert.notEqual(calls[0]?.id, calls[1]?.id);
    assert.equal(calls[1]?.params.requestState, 'private-resume-state');
    assert.deepEqual(calls[1]?.params.inputResponses, {
      details: { action: 'accept', content: { city: 'Shanghai' } },
    });
    assert.ok(!JSON.stringify(f.store.events(f.session.id)).includes('private-resume-state'));
    assert.equal(
      f.store
        .events(f.session.id)
        .filter(
          (e) => e.type === 'mcp/operation-started' && e.payload.toolId !== 'mcp.discover_tools',
        ).length,
      1,
    );
  } finally {
    await f.close();
  }
});

test('MCP refuses secret-collecting forms before asking the user', async () => {
  let asked = false;
  const f = await mcpExecutor(false, false, async () => {
    asked = true;
    return {};
  });
  try {
    f.remote.inputRequired = true;
    f.remote.form = {
      type: 'object',
      properties: { apiKey: { type: 'string' } },
      required: ['apiKey'],
    };
    const result = await f.execute(await f.select(), { text: 'test' });
    assert.equal(result.error?.code, 'MCP_SECRET_FORM_DENIED');
    assert.equal(asked, false);
    assert.equal(f.requests.filter((r) => r.method === 'tools/call').length, 1);
  } finally {
    await f.close();
  }
});

test('MCP continuation stops at eight rounds and never re-asks a declined form', async () => {
  let asked = 0,
    decline = false;
  const f = await mcpExecutor(false, false, async (items, _signal, validate) => {
    asked++;
    const answer = {
      questionId: 'fixture',
      answers: items.map((item) => ({ id: item.id, text: 'Shanghai', skipped: decline })),
    };
    validate?.(answer);
    return answer;
  });
  try {
    f.remote.inputRequired = true;
    f.remote.repeatInput = true;
    const name = await f.select();
    const result = await f.execute(name, { text: 'bounded' });
    assert.equal(result.error?.code, 'MCP_INPUT_LIMIT');
    assert.equal(asked, 8);
    assert.equal(f.requests.filter((r) => r.method === 'tools/call').length, 9);
    decline = true;
    asked = 0;
    const refused = await f.execute(name, { text: 'decline' });
    assert.equal(refused.error?.code, 'MCP_INPUT_DECLINED');
    assert.equal(asked, 1);
    assert.deepEqual(
      f.requests.filter((r) => r.method === 'tools/call').at(-1)?.params.inputResponses,
      { details: { action: 'decline' } },
    );
  } finally {
    await f.close();
  }
});

test('MCP checks all field counts and known secrets before sending a continuation', async () => {
  let asked = 0;
  const f = await mcpExecutor(false, false, async (items, _signal, validate) => {
    asked++;
    const answer = {
      questionId: 'fixture',
      answers: items.map((item) => ({ id: item.id, text: 'fixture-model-secret', skipped: false })),
    };
    validate?.(answer);
    return answer;
  });
  try {
    f.remote.inputRequired = true;
    const name = await f.select();
    let result = await f.execute(name, { text: 'test' });
    assert.equal(result.error?.code, 'MCP_SECRET_DENIED');
    assert.equal(f.requests.filter((r) => r.method === 'tools/call').length, 1);
    f.remote.form = {
      type: 'object',
      properties: Object.fromEntries(
        Array.from({ length: 13 }, (_, i) => ['field' + i, { type: 'string' }]),
      ),
    };
    result = await f.execute(name, { text: 'oversized' });
    assert.equal(result.error?.code, 'MCP_INPUT_LIMIT');
    assert.equal(asked, 1);
    assert.ok(!JSON.stringify(f.store.events(f.session.id)).includes('fixture-model-secret'));
  } finally {
    await f.close();
  }
});

test('legacy MCP form requests stay bound to the active call and use the same approval gate', async () => {
  let asked = 0;
  const f = await mcpExecutor(true, false, async (items, _signal, validate) => {
    asked++;
    const value = {
      questionId: 'fixture',
      answers: items.map((q) => ({ id: q.id, text: 'Shanghai', skipped: false })),
    };
    validate?.(value);
    return value;
  });
  try {
    f.remote.inputRequired = true;
    const result = await f.execute(await f.select(), { text: 'legacy' });
    assert.equal(result.status, 'succeeded');
    assert.equal(asked, 1);
    assert.deepEqual(f.remote.legacyForms.answers, [
      { action: 'accept', content: { city: 'Shanghai' } },
    ]);
    assert.equal(
      f.store.events(f.session.id).filter((e) => e.type === 'approval/requested').length,
      2,
    );
  } finally {
    await f.close();
  }
});

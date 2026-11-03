import { AgentRuntime } from '@praxis/agent-runtime';
import { McpPrompts } from '@praxis/mcp-client/prompts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mcpFixture } from './fixtures/mcp-server.ts';

for (const cancel of [false, true])
  test(`MCP prompt preview owns its form and approval lifetime (${cancel ? 'cancel' : 'answer'})`, async () => {
    let runtime: AgentRuntime | undefined;
    const f = await mcpFixture(false, false, true, (session) => {
      assert(runtime);
      return runtime.interaction('alice', session.id);
    });
    runtime = new AgentRuntime(f.store, {
      interactive: true,
      model: {
        complete: async () => {
          throw new Error('not a model turn');
        },
      },
      beginUse: async () => {
        throw new Error('not a model turn');
      },
    });
    await f.enable();
    f.remote.inputRequired = true;
    const prompts = new McpPrompts(f.mcp, f.configs, f.store, 'alice', (input, validate) =>
      f.store.accept(input, undefined, validate),
    );
    let questions = 0,
      approvals = 0;
    f.store.on('event', (event) => {
      assert(runtime);
      if (event.type === 'question/asked') {
        questions++;
        if (cancel) {
          void f.mcp.cancelUserOperations(f.session.id);
          return;
        }
        const question = runtime.pendingQuestion(f.session.id)!;
        runtime.answer('alice', {
          sessionId: f.session.id,
          questionId: question.questionId,
          turnId: question.turnId,
          answers: [{ id: 'field-0', text: 'Shanghai' }],
        });
      }
      if (event.type === 'approval/requested') {
        approvals++;
        const approval = runtime.approvals.snapshot(f.session.id)!;
        runtime.approvals.respond('alice', {
          sessionId: f.session.id,
          approvalId: approval.approvalId,
          turnId: approval.turnId,
          requestHash: approval.requestHash,
          decision: 'approve-once',
        });
      }
    });
    try {
      const catalog = await prompts.list(f.session.id, f.config.id);
      const preview = prompts.preview({
        sessionId: f.session.id,
        serverId: f.config.id,
        generation: catalog.generation,
        name: 'page',
        arguments: { topic: 'test' },
      });
      if (cancel) await assert.rejects(preview, { code: 'CANCELLED' });
      else assert.match((await preview).text, /test/);
      assert.equal(questions, 1);
      assert.equal(approvals, cancel ? 0 : 1);
      assert.equal(f.store.get(f.session.id).status, 'idle');
      assert.equal(f.store.messages(f.session.id).length, 0);
      assert.equal(runtime.pendingQuestion(f.session.id), null);
      assert.equal(f.requests.filter((r) => r.method === 'prompts/get').length, cancel ? 1 : 2);
    } finally {
      await runtime.close();
      await f.close();
    }
  });

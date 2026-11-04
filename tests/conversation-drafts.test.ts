import assert from 'node:assert/strict';
import test from 'node:test';
const { ConversationDrafts } = await import(
  new URL('../packages/ui/src/app/conversation-drafts.ts', import.meta.url).href
);

test('drafts survive navigation and reload without crossing identity or mode', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const drafts = new ConversationDrafts(storage, 'alice');
  drafts.write('chat:new', '聊天草稿');
  drafts.write('agent:new', '任务草稿');
  drafts.write('chat:session-a', '第一条会话');
  assert.equal(drafts.read('chat:new'), '聊天草稿');
  assert.equal(drafts.read('agent:new'), '任务草稿');
  assert.equal(new ConversationDrafts(storage, 'alice').read('chat:session-a'), '第一条会话');
  assert.equal(new ConversationDrafts(storage, 'bob').read('chat:new'), '');
});

test('successful submission only clears the captured revision of its originating draft', () => {
  const drafts = new ConversationDrafts(undefined, 'alice');
  drafts.write('chat:a', '提交内容');
  const sent = drafts.capture('chat:a');
  drafts.write('chat:b', '另一会话');
  drafts.write('chat:a', '请求返回前的修改');
  drafts.acknowledge(sent);
  assert.equal(drafts.read('chat:a'), '请求返回前的修改');
  assert.equal(drafts.read('chat:b'), '另一会话');
  drafts.acknowledge(drafts.capture('chat:a'));
  assert.equal(drafts.read('chat:a'), '');
  assert.equal(drafts.read('chat:b'), '另一会话');
});

test('creating a session carries the draft and in-flight receipt without losing later edits', () => {
  const drafts = new ConversationDrafts(undefined, 'alice');
  drafts.write('agent:new', '创建文件');
  const sent = drafts.capture('agent:new');
  drafts.move('agent:new', 'agent:created');
  assert.equal(drafts.read('agent:created'), '创建文件');
  assert.equal(drafts.read('agent:new'), '');
  drafts.acknowledge(sent);
  assert.equal(drafts.read('agent:created'), '');
});

test('storage denial preserves in-memory drafts and malformed cache never becomes a draft', () => {
  const drafts = new ConversationDrafts(
    {
      getItem: () => '{bad',
      setItem() {
        throw Error('quota');
      },
    },
    'alice',
  );
  drafts.write('chat:new', '不应丢失');
  assert.equal(drafts.read('chat:new'), '不应丢失');
  assert.equal(drafts.persistent, false);
});

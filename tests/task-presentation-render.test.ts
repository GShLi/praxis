import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { snapshot, approval } from './task-presentation-fixtures.ts';

type Views = typeof import('./task-presentation-render-fixture.tsx');
let views: Views;
let directory: string;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'praxis-task-presentation-'));
  const outfile = join(directory, 'render.mjs');
  await build({
    entryPoints: ['tests/task-presentation-render-fixture.tsx'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    loader: { '.css': 'empty' },
    banner: {
      js: `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);`,
    },
  });
  views = (await import(pathToFileURL(outfile).href)) as Views;
});
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('overview keeps terminal state, current action and honest elapsed data outside collapsed results', () => {
  for (const [status, label] of [
    ['completed', '已完成'],
    ['failed', '执行失败'],
    ['cancelled', '已停止'],
  ]) {
    const html = views.overview({ snapshot: snapshot(status) });
    const closed = html.indexOf('<details');
    assert.ok(html.indexOf(label!) < closed);
    assert.ok(html.indexOf('当前动作') < closed);
    assert.ok(html.indexOf('暂无时间记录') < closed);
    assert.match(html, /累计工具调用耗时 42 毫秒/);
    assert.doesNotMatch(html, /<details[^>]*\bopen/);
    const files = html.slice(html.indexOf('class="task-files"'));
    assert.match(files, /<button[^>]*>src\/example\.ts<\/button>/);
  }
});

test('pending requests offer an explicit jump and queued text remains collapsed with Chinese mode labels', () => {
  const state = snapshot('waiting_approval');
  state.approval = approval();
  state.question = {
    questionId: 'q',
    turnId: 'turn',
    questions: [{ id: 'city', prompt: '哪个城市？' }],
  };
  state.pendingInputs = [
    { id: 'queue', text: '稍后处理', mode: 'queue' },
    { id: 'steer', text: '先检查这里', mode: 'steer' },
  ];
  const html = views.overview({
    snapshot: state,
    onInteract: () => {
      throw new Error('render must not jump');
    },
  });
  assert.match(html, /前往处理/);
  assert.match(html, /哪个城市？/);
  assert.match(html, /待处理输入 · 2 条/);
  assert.match(html, /排队输入/);
  assert.match(html, /追加指导/);
  assert.doesNotMatch(html, /<details[^>]*\bopen/);
});

test('tool file action is outside raw-result disclosure and approval JSON is exact but collapsed', () => {
  const tool = views.tool();
  assert.ok(tool.indexOf('查看文件变更') < tool.indexOf('<details'));
  const html = views.approvalCard();
  assert.ok(html.indexOf('写入文件') < html.indexOf('<details'));
  assert.ok(html.indexOf('中文/hello.ts') < html.indexOf('<details'));
  assert.ok(html.indexOf('更改现有内容') < html.indexOf('<details'));
  assert.doesNotMatch(html, /<details[^>]*\bopen/);
  assert.match(html, /&quot;content&quot;: &quot;&lt;exact&gt;\\n你好&quot;/);
});

test('diff panel renders dual line numbers, additions and explicit read-only history', () => {
  const html = views.panel();
  assert.match(html, /只读历史快照/);
  assert.match(html, /不代表当前磁盘内容/);
  assert.match(html, /原行/);
  assert.match(html, /新行/);
  assert.match(html, /\+1 行/);
  assert.match(html, /−0 行/);
  assert.match(html, /aria-label="新增"/);
  assert.doesNotMatch(html, /contenteditable|textarea|应用变更|执行工具/);
});

test('loading and error replace stale content; retry is explicit and no read is triggered on render', () => {
  const loading = views.panel({ loading: true });
  assert.match(loading, /正在读取文件变更/);
  assert.doesNotMatch(loading, /src\/example.ts/);
  const failed = views.panel({
    error: '产物读取失败',
    onRetry: () => {
      throw new Error('render must not retry');
    },
  });
  assert.match(failed, /role="alert"/);
  assert.match(failed, /重试加载/);
  assert.doesNotMatch(failed, /src\/example.ts/);
  assert.match(views.panel({ change: null }), /选择一条文件修改记录/);
});

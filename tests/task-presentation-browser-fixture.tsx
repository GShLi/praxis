import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { snapshot, approval, result } from './task-presentation-fixtures.ts';
const { TaskOverview } = await import(`../packages/ui/src/conversation/TaskOverview.tsx`);
const { ToolCard } = await import(`../packages/ui/src/conversation/ToolCard.tsx`);
const { ApprovalCard } = await import(`../packages/ui/src/conversation/ApprovalCard.tsx`);
const { ChangePanel } = await import(`../packages/ui/src/conversation/ChangePanel.tsx`);

const failures: string[] = [];
function check(value: unknown, label: string) {
  if (!value) failures.push(label);
}
function click(label: string) {
  const button = [...document.querySelectorAll('button')].find((item) =>
    item.textContent?.includes(label),
  );
  if (!button) throw new Error(`Missing button: ${label}`);
  flushSync(() => button.click());
}

export async function run() {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const mount = (node: ReactNode) => flushSync(() => root.render(node));
  try {
    overviewInteraction(mount);
    toolInteraction(mount);
    await approvalInteraction(mount);
    panelInteraction(mount);
    check(
      document.documentElement.scrollWidth <= window.innerWidth,
      'page overflows narrow viewport',
    );
    return failures;
  } finally {
    flushSync(() => root.unmount());
    container.remove();
  }
}

function overviewInteraction(mount: (node: ReactNode) => void) {
  const files: string[] = [];
  let jumped = 0;
  const state = snapshot('waiting_approval');
  state.approval = approval();
  mount(
    <TaskOverview
      snapshot={state}
      showChange={(id) => files.push(id)}
      onInteract={() => jumped++}
    />,
  );
  check(files.length === 0 && jumped === 0, 'render performed an action');
  const results = document.querySelector<HTMLDetailsElement>('.task-result-details');
  check(results && !results.open, 'results initially expanded');
  results?.querySelector('summary')?.click();
  click('src/example.ts');
  check(files.join() === 'artifact', 'one disclosure must expose a file action');
  check(
    !document.querySelector('.task-results details[open]'),
    'file action expanded raw tool details',
  );
  click('前往处理');
  check(jumped === 1, 'explicit pending-request jump did not run');
}

function toolInteraction(mount: (node: ReactNode) => void) {
  const files: string[] = [];
  mount(<ToolCard content={JSON.stringify(result())} showChange={(id) => files.push(id)} />);
  click('查看文件变更');
  check(files.join() === 'artifact', 'tool direct file action failed');
  check(!document.querySelector('details[open]'), 'direct file action expanded result JSON');
}

async function approvalInteraction(mount: (node: ReactNode) => void) {
  let calls = 0;
  let rejectRequest: ((failure: Error) => void) | undefined;
  mount(
    <ApprovalCard
      approval={approval()}
      submit={() => {
        calls++;
        return new Promise<void>((_resolve, reject) => {
          rejectRequest = reject;
        });
      }}
    />,
  );
  check(calls === 0, 'approval submitted on render');
  const approve = [...document.querySelectorAll('button')].find(
    (button) => button.textContent === '批准一次',
  );
  flushSync(() => {
    approve?.click();
    approve?.click();
  });
  check(calls === 1, 'double click submitted approval twice');
  rejectRequest?.(new Error('审批连接失败'));
  await new Promise((resolve) => setTimeout(resolve, 10));
  check(
    document.querySelector('[role="alert"]')?.textContent === '审批连接失败',
    'approval failure not visible',
  );
  check(!approve?.disabled, 'failed approval cannot be retried');
}

function panelInteraction(mount: (node: ReactNode) => void) {
  let retries = 0;
  mount(
    <ChangePanel setPanel={() => {}} change={null} error="读取失败" onRetry={() => retries++} />,
  );
  check(retries === 0, 'panel automatically retried');
  click('重试加载');
  check(retries === 1, 'explicit retry did not run');
  document.documentElement.dataset.theme = 'dark';
  mount(
    <ChangePanel
      setPanel={() => {}}
      change={{
        path: '长路径/'.repeat(30),
        before: '旧内容\n',
        after: '很长的新增行'.repeat(1000),
      }}
    />,
  );
  const scroll = document.querySelector<HTMLElement>('.task-diff-scroll');
  check(scroll && scroll.scrollWidth > scroll.clientWidth, 'long line should scroll inside diff');
  check(document.querySelector('table th')?.textContent === '原行', 'diff headers absent');
}

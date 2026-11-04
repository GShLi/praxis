import { renderToStaticMarkup } from 'react-dom/server';
const { TaskOverview } = await import(`../packages/ui/src/conversation/TaskOverview.tsx`);
type TaskOverviewProps = Parameters<typeof TaskOverview>[0];
const { ToolCard } = await import(`../packages/ui/src/conversation/ToolCard.tsx`);
const { ApprovalCard } = await import(`../packages/ui/src/conversation/ApprovalCard.tsx`);
const { ChangePanel } = await import(`../packages/ui/src/conversation/ChangePanel.tsx`);
type ChangePanelProps = Parameters<typeof ChangePanel>[0];
import { approval, result, snapshot } from './task-presentation-fixtures.ts';

export function overview(props: Partial<TaskOverviewProps> = {}) {
  return renderToStaticMarkup(
    <TaskOverview
      snapshot={snapshot()}
      showChange={() => {
        throw new Error('render must not open artifacts');
      }}
      {...props}
    />,
  );
}
export function tool() {
  return renderToStaticMarkup(
    <ToolCard
      content={JSON.stringify(result())}
      showChange={() => {
        throw new Error('render must not open artifacts');
      }}
    />,
  );
}
export function approvalCard() {
  return renderToStaticMarkup(
    <ApprovalCard
      approval={approval()}
      submit={async () => {
        throw new Error('render must not approve');
      }}
    />,
  );
}
export function panel(props: Partial<ChangePanelProps> = {}) {
  return renderToStaticMarkup(
    <ChangePanel
      change={{ path: 'src/example.ts', before: 'a\nb\n', after: 'a\nnew\nb\n' }}
      setPanel={() => {
        throw new Error('render must not close');
      }}
      {...props}
    />,
  );
}

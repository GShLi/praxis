import type { ApprovalRequest } from '@praxis/permissions';
import { useEffect, useRef, useState } from 'react';
import { Copy } from '../MarkdownView.tsx';
import { approvalPresentation, resourceLabels } from './approval-presentation.ts';
import '../styles/task-feedback.css';

export function ApprovalCard({
  approval,
  submit,
}: {
  approval: ApprovalRequest;
  submit: (decision: 'approve-once' | 'deny') => Promise<void>;
}) {
  const { busy, error, decide } = useApprovalDecision(submit);
  const description = approvalPresentation(approval);
  return (
    <section className="approval-card task-approval" aria-label="执行审批" aria-busy={busy}>
      <div className="approval-heading">
        <span>需要你的批准</span>
        <small>仅此次操作</small>
      </div>
      <h3>{description.action}</h3>
      <p className="task-target">{description.target}</p>
      <p>{description.effect}</p>
      {description.description && <p>{description.description}</p>}
      <p>{approval.reason}</p>
      <ApprovalParameters approval={approval} />
      <p className="approval-note">批准只适用于这里显示的参数，不会授权之后的操作。</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="approval-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => void decide('deny')}
        >
          拒绝
        </button>
        <button
          type="button"
          className="primary-button compact"
          disabled={busy}
          onClick={() => void decide('approve-once')}
        >
          {busy ? '正在提交…' : '批准一次'}
        </button>
      </div>
    </section>
  );
}

function ApprovalParameters({ approval }: { approval: ApprovalRequest }) {
  const parameters = JSON.stringify(approval.parameters, null, 2) ?? 'null';
  return (
    <>
      {approval.resources && (
        <dl>
          {Object.entries(approval.resources).map(([name, value]) => (
            <div key={name}>
              <dt>{resourceLabels[name] ?? name}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <details>
        <summary>查看本次操作的完整参数</summary>
        <p className="task-note">工具：{approval.toolId}</p>
        <Copy text={parameters} />
        <pre>{parameters}</pre>
      </details>
    </>
  );
}

function useApprovalDecision(submit: (decision: 'approve-once' | 'deny') => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const decide = async (decision: 'approve-once' | 'deny') => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await submit(decision);
    } catch (failure) {
      if (!mounted.current) return;
      setError(failure instanceof Error ? failure.message : '审批未能提交。');
      pending.current = false;
      setBusy(false);
    }
  };
  return { busy, error, decide };
}

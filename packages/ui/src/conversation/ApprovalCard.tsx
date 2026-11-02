import type { ApprovalRequest } from '@praxis/permissions';
import { useState } from 'react';

export function ApprovalCard({
  approval,
  submit,
}: {
  approval: ApprovalRequest;
  submit: (decision: 'approve-once' | 'deny') => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const decide = (decision: 'approve-once' | 'deny') => {
    setBusy(true);
    setError('');
    void submit(decision).catch((failure) => {
      setError(failure instanceof Error ? failure.message : '审批未能提交。');
      setBusy(false);
    });
  };
  return (
    <section className="approval-card" aria-label="执行审批">
      <div className="approval-heading">
        <span>需要你的批准</span>
        <small>仅此次操作</small>
      </div>
      <h3>{approval.toolId}</h3>
      <p>{approval.reason}</p>
      {approval.resources && (
        <dl>
          {Object.entries(approval.resources).map(([name, value]) => (
            <div key={name}>
              <dt>{name === 'workspace' ? '工作区' : name}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <details open>
        <summary>本次操作的完整参数</summary>
        <pre>{JSON.stringify(approval.parameters, null, 2)}</pre>
      </details>
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
          onClick={() => decide('deny')}
        >
          拒绝
        </button>
        <button
          type="button"
          className="primary-button compact"
          disabled={busy}
          onClick={() => decide('approve-once')}
        >
          {busy ? '正在提交…' : '批准一次'}
        </button>
      </div>
    </section>
  );
}

import type { Dispatch, SetStateAction } from 'react';
export function ModelCapacity({
  windowSize,
  setWindowSize,
  output,
  setOutput,
}: {
  windowSize: number;
  output: number;
  setWindowSize: Dispatch<SetStateAction<number>>;
  setOutput: Dispatch<SetStateAction<number>>;
}) {
  return (
    <details
      className="provider-advanced"
      onInvalidCapture={(event) => {
        event.currentTarget.open = true;
      }}
    >
      <summary>高级设置</summary>
      <div className="settings-fields">
        <label>
          上下文窗口
          <input
            type="number"
            min={8192}
            max={2000000}
            value={windowSize}
            onChange={(e) => setWindowSize(Number(e.target.value))}
            required
          />
        </label>
        <label>
          最大输出 Tokens
          <input
            type="number"
            min={256}
            max={393216}
            value={output}
            onChange={(e) => setOutput(Number(e.target.value))}
            required
          />
        </label>
      </div>
      <p className="field-help">模型列表不一定包含容量信息，请以厂商公布的信息为准。</p>
    </details>
  );
}

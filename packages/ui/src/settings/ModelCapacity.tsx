import type { Dispatch, SetStateAction } from 'react';
export function ModelCapacity({
  adapter,
  setAdapter,
  windowSize,
  setWindowSize,
  output,
  setOutput,
}: {
  adapter: string;
  setAdapter: (value: string) => void;
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
      <label>
        模型适配器
        <input
          value={adapter}
          onChange={(e) => setAdapter(e.target.value)}
          required
          maxLength={180}
          placeholder="openai-compatible 或 插件ID/适配器ID"
        />
      </label>
      <p className="field-help">
        默认适用于 DeepSeek 等兼容接口。使用插件时填写其提供的适配器名称和模型
        ID；运行模型的客户端或服务端必须已启用该插件。
      </p>
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

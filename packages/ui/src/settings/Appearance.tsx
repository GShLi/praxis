import { Select } from '../controls/Select.tsx';
import { useState } from 'react';
import { Row } from './controls.tsx';

export function Appearance() {
  const [theme, setTheme] = useState(localStorage.getItem('praxis-theme') ?? 'system');
  const [font, setFont] = useState(localStorage.getItem('praxis-font') ?? '16');
  return (
    <>
      <section className="settings-section">
        <h2>视觉样式</h2>
        <div className="settings-group">
          <Row title="模式">
            <div className="theme-segments" role="group" aria-label="主题模式">
              {(['system', 'light', 'dark'] as const).map((value) => (
                <button
                  key={value}
                  aria-pressed={theme === value}
                  className={theme === value ? 'selected' : ''}
                  onClick={() => {
                    setTheme(value);
                    document.documentElement.dataset.theme = value;
                    localStorage.setItem('praxis-theme', value);
                  }}
                >
                  {value === 'system' ? '系统' : value === 'light' ? '浅色' : '深色'}
                </button>
              ))}
            </div>
          </Row>
        </div>
      </section>
      <section className="settings-section">
        <h2>文字</h2>
        <div className="settings-group">
          <Row title="回答字号" description="调整对话内容的文字大小。">
            <Select
              aria-label="回答字号"
              value={font}
              onChange={(value) => {
                setFont(value);
                localStorage.setItem('praxis-font', value);
                document.documentElement.style.setProperty('--message-font', `${value}px`);
              }}
            >
              <option value="14">紧凑 · 14</option>
              <option value="16">标准 · 16</option>
              <option value="18">舒适 · 18</option>
            </Select>
          </Row>
        </div>
        <div className="appearance-preview" aria-label="回答样式预览">
          <span>预览</span>
          <p>我能帮你做些什么？</p>
          <div>一起梳理思路，理解问题，完成你的下一个想法。</div>
        </div>
      </section>
      <p className="settings-footnote">外观自动保存在当前客户端。</p>
    </>
  );
}

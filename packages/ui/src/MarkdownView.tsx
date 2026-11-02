import { isValidElement, useState } from 'react';
import type { ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Icon } from './Navigation.tsx';

export function Copy({ text, iconOnly = false }: { text: string; iconOnly?: boolean }) {
  const [copied, setCopied] = useState(false),
    [copyFailed, setCopyFailed] = useState(false);
  return (
    <button
      className={iconOnly ? 'icon-button copy-button' : 'text-button copy-button'}
      aria-label={copyFailed ? '复制失败，请重试' : copied ? '已复制' : '复制'}
      title={copyFailed ? '复制失败，请重试' : copied ? '已复制' : '复制'}
      onClick={() => {
        void navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopyFailed(false);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => {
            setCopied(false);
            setCopyFailed(true);
          });
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} />
      {!iconOnly && (copyFailed ? '复制失败，请重试' : copied ? '已复制' : '复制')}
    </button>
  );
}
export function MarkdownView({ content }: { content: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      components={{
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
        pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
      }}
    >
      {content}
    </Markdown>
  );
}
function CodeBlock({ children }: { children: ReactNode }) {
  const [wrap, setWrap] = useState(false);
  const code = Array.isArray(children) ? children.find(isValidElement) : children;
  const language = isValidElement<{ className?: string }>(code)
    ? (code.props.className?.replace('language-', '') ?? '代码')
    : '代码';
  return (
    <div className="code-block">
      <div className="code-header">
        <span>{language}</span>
        <div className="code-actions">
          <button
            className="icon-button"
            aria-label="代码自动换行"
            aria-pressed={wrap}
            title="自动换行"
            onClick={() => setWrap(!wrap)}
          >
            <Icon name="wrap" />
          </button>
          <Copy text={extractText(children)} />
        </div>
      </div>
      <pre className={wrap ? 'wrap-code' : ''}>{children}</pre>
    </div>
  );
}
function extractText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (node && typeof node === 'object' && 'props' in node)
    return extractText((node.props as { children?: ReactNode }).children);
  return '';
}

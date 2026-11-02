import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownView } from '../packages/ui/src/MarkdownView.tsx';

test('model HTML is displayed as source code and never executed in the conversation', () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownView, {
      content: '```html\n<script>alert("model output")</script>\n<h1>HelloWorld！</h1>\n```',
    }),
  );
  assert.match(html, /language-html/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;h1&gt;HelloWorld！&lt;\/h1&gt;/);
  assert.doesNotMatch(html, /<script|<iframe|<h1>/);
});

test('conversation Markdown drops raw HTML and unsafe links while preserving safe external links', () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownView, {
      content:
        '<img src=x onerror=alert(1)>\n\n[unsafe](javascript:alert)\n\n[reference](https://example.com/docs)',
    }),
  );
  assert.doesNotMatch(html, /<img|onerror|javascript:/);
  assert.match(
    html,
    /href="https:\/\/example.com\/docs" target="_blank" rel="noopener noreferrer"/,
  );
});

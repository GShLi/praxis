import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const { SettingsLoadState } = await import(
  new URL('../packages/ui/src/settings/SettingsLoadState.tsx', import.meta.url).href
);
const { McpEditor } = await import(
  new URL('../packages/ui/src/settings/McpEditor.tsx', import.meta.url).href
);
const { PluginEditor } = await import(
  new URL('../packages/ui/src/settings/PluginEditor.tsx', import.meta.url).href
);
const { Status } = await import(
  new URL('../packages/ui/src/settings/controls.tsx', import.meta.url).href
);
const { Account } = await import(
  new URL('../packages/ui/src/settings/Account.tsx', import.meta.url).href
);

test('read states expose retry only for failure and never claim an empty list', () => {
  const render = (status: string) =>
    renderToStaticMarkup(
      createElement(SettingsLoadState, {
        status,
        error: 'offline',
        label: 'MCP 连接',
        retry: async () => true,
      }),
    );
  assert.match(render('loading'), /正在读取MCP 连接/);
  assert.doesNotMatch(render('loading'), /重试读取|还没有/);
  assert.match(render('error'), /role="alert"/);
  assert.match(render('error'), /重试读取/);
  assert.match(render('unsupported'), /尚不支持/);
  assert.equal(render('ready'), '');
});

test('MCP forms use the shared dialog, lock every field while saving, and retain protocol choices', () => {
  const html = renderToStaticMarkup(
    createElement(McpEditor, {
      busy: true,
      canSave: true,
      retry: async () => true,
      save: async () => false,
      cancel: () => {},
    }),
  );
  assert.match(html, /<dialog[^>]*class="settings-dialog"/);
  assert.match(html, /<fieldset disabled=""/);
  assert.match(html, /关闭弹窗" disabled=""/);
  assert.match(html, /role="listbox"/);
  assert.match(html, /自动协商/);
  assert.match(html, /2026-07-28/);
  assert.match(html, /2025-11-25/);
  assert.match(html, /每次调用需要确认/);
});

test('plugin dialogs use the optional picker and require a review before trust/install', () => {
  const props = {
    saving: false,
    canSave: true,
    retry: async () => true,
    save: async () => false,
    close: () => {},
  };
  const withPicker = renderToStaticMarkup(
    createElement(PluginEditor, { ...props, client: { selectPluginDirectory: async () => null } }),
  );
  const withoutPicker = renderToStaticMarkup(createElement(PluginEditor, { ...props, client: {} }));
  assert.match(withPicker, /选择文件夹/);
  assert.match(withPicker, /disabled="">信任此来源并安装/);
  assert.doesNotMatch(withoutPicker, /选择文件夹/);
  assert.match(withoutPicker, /已构建插件的目录/);
});

test('API keys start in loading state without showing a false empty list', () => {
  const html = renderToStaticMarkup(
    createElement(Account, {
      client: { keys: async () => [], createKey: async () => 'fixture-only' },
      profile: null,
      profileError: '',
      logout: async () => {},
    }),
  );
  assert.match(html, /正在读取访问密钥/);
  assert.doesNotMatch(html, /还没有为客户端创建访问密钥/);
});

test('feedback distinguishes errors from successful and legacy neutral messages', () => {
  assert.match(
    renderToStaticMarkup(createElement(Status, { message: 'failed', variant: 'error' })),
    /role="alert"/,
  );
  assert.match(
    renderToStaticMarkup(createElement(Status, { message: 'saved', variant: 'success' })),
    /settings-feedback-success/,
  );
  assert.match(renderToStaticMarkup(createElement(Status, { message: 'legacy' })), /role="status"/);
});

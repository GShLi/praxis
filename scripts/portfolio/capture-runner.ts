import { app, BrowserWindow } from 'electron';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

interface Scene {
  name: string;
  desktop?: boolean;
  tab?: string;
  session?: string;
  theme?: 'light' | 'dark';
  action?: string;
}

const scenes: Scene[] = [
  { name: '01-web-chat', session: '山岚工作室 · 官网策划' },
  { name: '02-web-code', session: '山岚工作室 · 响应式首页' },
  {
    name: '03-model-providers',
    tab: 'models',
    action: 'document.querySelector("#provider-tab-models").click()',
  },
  { name: '04-desktop-agent', desktop: true, session: '山岚官网 · 实现与验收' },
  { name: '05-desktop-approval', desktop: true, session: '山岚官网 · 发布前检查' },
  { name: '06-mcp-connections', desktop: true, tab: 'mcp' },
  { name: '07-dark-chat', session: '山岚工作室 · 官网策划', theme: 'dark' },
  {
    name: '08-file-diff',
    desktop: true,
    session: '山岚官网 · 实现与验收',
    action: `(async () => {
    document.querySelector('.task-result-details > summary').click();
    await new Promise(resolve => setTimeout(resolve, 50));
    [...document.querySelectorAll('.task-files button')].find(b => b.textContent === 'src/styles/projects.css').click();
    document.querySelector('.task-result-details > summary').click();
    document.querySelector('[aria-label="关闭侧栏"]').click();
  })()`,
  },
];

async function waitFor(window: BrowserWindow, expression: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Showcase did not become ready: ${expression}`);
}

async function prepareScene(window: BrowserWindow, directory: string, scene: Scene) {
  await window.loadFile(path.join(directory, 'index.html'), {
    query: { client: scene.desktop ? 'desktop' : 'web', theme: scene.theme ?? 'light' },
    hash: scene.tab ? `settings/${scene.tab}` : '',
  });
  await waitFor(window, 'Boolean(document.querySelector(".product-shell"))');
  if (scene.session) {
    if (scene.desktop) {
      await window.webContents.executeJavaScript(
        '[...document.querySelectorAll(".mode-switch button")].find(b => b.textContent.trim() === "Agent").click()',
      );
    }
    const selector = `.history-session[title=${JSON.stringify(scene.session)}]`;
    await waitFor(window, `Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    await window.webContents.executeJavaScript(
      `document.querySelector(${JSON.stringify(selector)}).click()`,
    );
    await waitFor(window, 'Boolean(document.querySelector(".message"))');
  }
  if (scene.action) await window.webContents.executeJavaScript(scene.action);
  await window.webContents.executeJavaScript('document.fonts.ready');
  await new Promise((resolve) => setTimeout(resolve, 800));
  if (scene.desktop && scene.session) {
    await window.webContents.executeJavaScript(`(() => {
      const scroll = document.querySelector('.conversation');
      const target = document.querySelector('.approval-card') ?? [...document.querySelectorAll('.message.assistant')].at(-1);
      if (scroll && target) scroll.scrollTop += target.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 16;
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await window.webContents.executeJavaScript('document.activeElement?.blur()');
}

async function capture(window: BrowserWindow, directory: string, output: string) {
  const records = [];
  for (const scene of scenes) {
    await prepareScene(window, directory, scene);
    const overflow = await window.webContents.executeJavaScript(
      'document.documentElement.scrollWidth > innerWidth',
    );
    if (overflow) throw new Error(`Horizontal page overflow: ${scene.name}`);
    const bytes = (await window.webContents.capturePage()).toPNG();
    const filename = `${scene.name}.png`;
    await writeFile(path.join(output, filename), bytes);
    records.push({
      filename,
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      theme: scene.theme ?? 'light',
      client: scene.desktop ? 'desktop' : 'web',
      demoData: true,
    });
  }
  await writeFile(path.join(output, 'screenshots.json'), JSON.stringify(records, null, 2) + '\n');
  console.log(JSON.stringify(records, null, 2));
}

async function main() {
  const directory = process.argv[2],
    output = process.argv[3];
  if (!directory || !output) throw new Error('Expected fixture directory and output directory');
  app.setPath('userData', path.join(directory, 'profile'));
  app.commandLine.appendSwitch('force-prefers-reduced-motion');
  app.commandLine.appendSwitch('force-device-scale-factor', '2');
  await app.whenReady();
  const window = new BrowserWindow({
    show: false,
    width: 1440,
    height: 960,
    useContentSize: true,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
  });
  try {
    // All content is local. Reject accidental model/auth/remote requests from fixtures.
    window.webContents.session.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*'] },
      (_details, callback) => callback({ cancel: true }),
    );
    await capture(window, directory, output);
  } finally {
    window.destroy();
  }
}

main().then(
  () => app.exit(0),
  (error: unknown) => {
    console.error(error);
    app.exit(1);
  },
);

const { app, BrowserWindow } = require('electron');
const { writeFile, mkdir } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

// Isolated, unauthenticated browser profile; never attach to a user's browser.
app.setPath('userData', process.argv[2]);

async function waitFor(window, selector) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (
      await window.webContents.executeJavaScript(
        `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
      )
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${selector}`);
}

async function capture(window, name) {
  const directory = process.env.PRAXIS_UI_CAPTURE_DIRECTORY;
  if (!directory) return;
  await window.webContents.executeJavaScript(`Promise.all(document.getAnimations()
    .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
    .map(animation => animation.finished.catch(() => undefined)))`);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, name + '.png'),
    (await window.webContents.capturePage()).toPNG(),
  );
}

async function verifyFailure(window) {
  window.webContents.session.webRequest.onBeforeRequest(
    { urls: ['http://127.0.0.1:4311/v1/me'] },
    (_, callback) => callback({ cancel: true }),
  );
  window.webContents.reload();
  await waitFor(window, '.connection-card [role="alert"]');
  for (const [width, theme] of [
    [980, 'light'],
    [360, 'dark'],
  ]) {
    window.setContentSize(width, 800);
    await window.webContents.executeJavaScript(
      `document.documentElement.dataset.theme = '${theme}'`,
    );
    const layout = await window.webContents.executeJavaScript(`({
      overflow: document.documentElement.scrollWidth > innerWidth,
      cardWidth: document.querySelector('.connection-card').getBoundingClientRect().width,
      buttonWidth: document.querySelector('.connection-card > button').getBoundingClientRect().width,
      expanded: document.querySelector('.connection-details').open
    })`);
    assert.equal(layout.overflow, false);
    assert(layout.cardWidth <= 420 && layout.buttonWidth < layout.cardWidth);
    assert.equal(layout.expanded, false);
    await capture(window, 'connection-' + theme);
  }
  window.webContents.session.webRequest.onBeforeRequest(null);
  await window.webContents.executeJavaScript(
    "document.querySelector('.connection-card > button').click()",
  );
  await waitFor(window, 'form.login-form');
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 980,
    height: 800,
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  try {
    await window.loadURL('http://127.0.0.1:4311/');
    await waitFor(window, 'form.login-form');
    const title = await window.webContents.executeJavaScript(
      "document.querySelector('h1').textContent",
    );
    assert.equal(title, '欢迎使用知行');
    await capture(window, 'anonymous-login');
    await verifyFailure(window);
    console.log('WEB_STARTUP_OK: anonymous login, failure layout, retry recovery');
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});

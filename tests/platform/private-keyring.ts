import assert from 'node:assert/strict';
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const execute = promisify(execFile);

/** Runs only inside the test's private D-Bus session and disposable HOME. */
export class PrivateKeyring {
  private child: ChildProcessWithoutNullStreams;
  private closed: Promise<void>;
  private failure: Error | undefined;

  constructor() {
    const helper = process.env.PRAXIS_TEST_KEYRING_HELPER;
    assert(helper && process.env.PRAXIS_TEST_PRIVATE_KEYRING === '1');
    assert(process.env.HOME && process.env.DBUS_SESSION_BUS_ADDRESS);
    this.child = spawn(
      helper,
      [
        '--foreground',
        '--unlock',
        '--components=secrets',
        `--control-directory=${path.join(process.env.HOME, 'control')}`,
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    this.child.stdout.resume();
    this.child.stderr.resume();
    this.child.stdin.on('error', () => {
      // Startup/exit owns the error if the trusted daemon rejects its private stdin.
    });
    this.child.once('error', (error) => {
      this.failure = error;
    });
    this.closed = new Promise((resolve) => this.child.once('close', () => resolve()));
    this.child.stdin.end('praxis-disposable-fixture-password');
  }

  async ready() {
    try {
      const deadline = performance.now() + 5000;
      while (performance.now() < deadline) {
        if (this.failure) throw this.failure;
        assert(
          this.child.exitCode === null && this.child.signalCode === null,
          'Private keyring exited.',
        );
        const reply = await execute(
          '/usr/bin/busctl',
          [
            '--user',
            'call',
            'org.freedesktop.DBus',
            '/org/freedesktop/DBus',
            'org.freedesktop.DBus',
            'NameHasOwner',
            's',
            'org.freedesktop.secrets',
          ],
          { timeout: 1000, maxBuffer: 1024 },
        );
        if (reply.stdout.trim() === 'b true') return;
        await delay(20);
      }
      throw new Error('Private Secret Service startup timed out.');
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop() {
    const timer = setTimeout(() => this.child.kill('SIGKILL'), 2000);
    try {
      this.child.kill('SIGTERM');
      await this.closed;
    } finally {
      clearTimeout(timer);
    }
  }

  async lock() {
    const base = [
      '--user',
      'call',
      'org.freedesktop.secrets',
      '/org/freedesktop/secrets',
      'org.freedesktop.Secret.Service',
    ];
    const alias = await execute('/usr/bin/busctl', [...base, 'ReadAlias', 's', 'default'], {
      timeout: 1000,
    });
    const match = /^o "(\/org\/freedesktop\/secrets\/collection\/[^"\n]+)"\s*$/.exec(alias.stdout);
    assert(match?.[1], 'Private keyring must have a default collection.');
    const collection = match[1];
    await execute('/usr/bin/busctl', [...base, 'Lock', 'ao', '1', collection], { timeout: 1000 });
    const result = await execute(
      '/usr/bin/busctl',
      [
        '--user',
        'get-property',
        'org.freedesktop.secrets',
        collection,
        'org.freedesktop.Secret.Collection',
        'Locked',
      ],
      { timeout: 1000 },
    );
    assert.equal(result.stdout.trim(), 'b true');
  }
}

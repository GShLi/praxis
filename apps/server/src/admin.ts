import type { AuthService } from '@praxis/auth';
import { assert } from '@praxis/contracts';
import { createInterface } from 'node:readline/promises';
async function secretPrompt(prompt: string): Promise<string> {
  assert(process.stdin.isTTY, 'TTY_REQUIRED', '管理员密码必须通过交互终端输入。');
  process.stderr.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = () => {
      process.stdin.off('data', data);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stderr.write('\n');
    };
    const data = (chunk: Buffer) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          finish();
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          finish();
          reject(new Error('cancelled'));
          return;
        }
        if (ch === '\u007f') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    };
    process.stdin.on('data', data);
  });
}

export async function createAdmin(auth: AuthService) {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  let username: string;
  try {
    username = await terminal.question('账号：');
  } finally {
    terminal.close();
  }
  const password = await secretPrompt('密码（至少 12 字节，不回显）：');
  await auth.createUser(username, password, true);
  console.log('账号已创建。');
}

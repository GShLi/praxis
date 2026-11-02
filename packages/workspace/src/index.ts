import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PraxisError } from '../../contracts/src/index.ts';

export const defaultLeaseExecutable = process.env.PRAXIS_NATIVE_DIR
  ? path.join(
      process.env.PRAXIS_NATIVE_DIR,
      `praxis-lease${process.platform === 'win32' ? '.exe' : ''}`,
    )
  : fileURLToPath(
      new URL(
        `../../../build/native/praxis-lease${process.platform === 'win32' ? '.exe' : ''}`,
        import.meta.url,
      ),
    );
export async function acquireLease(lockFile: string, executable = defaultLeaseExecutable) {
  await mkdir(path.dirname(lockFile), { recursive: true, mode: 0o700 });
  const child = spawn(executable, [lockFile], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stderr.resume();
  let closing = false;
  let onLost = () => {};
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new PraxisError('LOCK_UNAVAILABLE', '系统锁启动超时。'));
    }, 5000);
    child.once('error', () => {
      clearTimeout(timeout);
      reject(new PraxisError('LOCK_UNAVAILABLE', '请先构建对应平台的原生锁组件。'));
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      if (!closing) onLost();
      reject(
        new PraxisError(
          code === 73 ? 'WORKSPACE_BUSY' : 'LOCK_UNAVAILABLE',
          code === 73 ? '资源正在被另一个客户端使用。' : '系统锁进程退出。',
        ),
      );
    });
    child.stdout.once('data', (data: Buffer) => {
      clearTimeout(timeout);
      if (data.toString().trim() === '{"locked":true}') resolve();
      else {
        child.kill();
        reject(new PraxisError('LOCK_UNAVAILABLE', '无效系统锁握手。'));
      }
    });
  });
  return {
    onLost(callback: () => void) {
      onLost = callback;
      if (child.exitCode !== null) callback();
    },
    async release() {
      closing = true;
      if (child.exitCode !== null) return;
      await new Promise<void>((resolve) => {
        const deadline = setTimeout(() => {
          child.kill();
          resolve();
        }, 1000);
        child.once('exit', () => {
          clearTimeout(deadline);
          resolve();
        });
        child.stdin.end();
      });
    },
  };
}

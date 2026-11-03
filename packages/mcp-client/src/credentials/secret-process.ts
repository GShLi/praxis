import { assert, PraxisError } from '@praxis/contracts';
import { spawn } from 'node:child_process';

/** Fixed trusted helper only. Secret values travel in pipes, never argv or inherited environment. */
export function secretProcess(
  executable: string,
  args: string[],
  input: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const env: NodeJS.ProcessEnv = {};
  for (const name of [
    'SYSTEMROOT',
    'WINDIR',
    'USERPROFILE',
    'HOME',
    'DBUS_SESSION_BUS_ADDRESS',
    'XDG_RUNTIME_DIR',
  ])
    if (process.env[name]) env[name] = process.env[name];
  const child = spawn(executable, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
    windowsHide: true,
  });
  return new Promise<{ code: number; output: string }>((resolve, reject) => {
    let failure: Error | undefined;
    let bytes = 0;
    const chunks: Buffer[] = [];
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = (error: Error) => {
      failure ??= error;
      child.kill();
      killTimer ??= setTimeout(() => child.kill('SIGKILL'), 500);
    };
    const abort = () => stop(new PraxisError('CANCELLED', '凭据操作已取消。'));
    const timer = setTimeout(
      () => stop(new PraxisError('SECRET_STORE_TIMEOUT', '系统凭据操作超时，未自动改用内存。')),
      10000,
    );
    signal.addEventListener('abort', abort, { once: true });
    child.stderr.resume();
    child.stdin.on('error', () => {
      /* A rejected/closed helper owns the terminal error. */
    });
    child.once('error', () => {
      failure = new PraxisError('SECRET_STORE_UNAVAILABLE', '系统凭据存储不可用。');
    });
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 65536) stop(new PraxisError('SECRET_LIMIT', '系统凭据结果超过限制。'));
      else chunks.push(chunk);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else {
        try {
          assert(code !== null, 'SECRET_STORE_UNAVAILABLE', '系统凭据进程已中止。');
          resolve({ code, output: Buffer.concat(chunks).toString('utf8') });
        } catch (error) {
          reject(error);
        }
      }
      for (const chunk of chunks) chunk.fill(0);
    });
    child.stdin.end(input);
    if (signal.aborted) abort();
  });
}

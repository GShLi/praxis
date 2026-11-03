import { assert, PraxisError } from '@praxis/contracts';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileResponseController } from './response-controller.ts';

function executable() {
  const filename = `praxis-files${process.platform === 'win32' ? '.exe' : ''}`;
  return process.env.PRAXIS_NATIVE_DIR
    ? path.join(process.env.PRAXIS_NATIVE_DIR, filename)
    : fileURLToPath(
        new URL(
          `${import.meta.url.endsWith('.mjs') ? '../../' : '../../../../../'}build/native/${filename}`,
          import.meta.url,
        ),
      );
}

/** One operation owns one fixed native process. EOF denies publication; no user code is loaded. */
export async function nativeRequest(
  payload: Buffer,
  signal: AbortSignal,
  beforeCommit?: () => void,
) {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  deadline.throwIfAborted();
  const child = spawn(executable(), [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {},
  });
  child.stderr.resume();
  const response = new FileResponseController(child, deadline, beforeCommit);
  child.stdout.on('data', response.consume);
  child.stdin.on('error', () => {
    /* The final response/exit owns failure mapping when the helper closes stdin. */
  });
  deadline.addEventListener('abort', response.abort, { once: true });
  try {
    const exited = new Promise<number | null>((resolve) => {
      child.once('error', () => {
        response.failure = new PraxisError(
          'FILE_NATIVE_UNAVAILABLE',
          '原生文件组件不可用，请先构建对应平台组件。',
        );
      });
      child.once('close', resolve);
    });
    if (deadline.aborted) response.abort();
    if (!response.failure) {
      if (beforeCommit) child.stdin.write(payload);
      else child.stdin.end(payload);
    }
    const code = await exited;
    if (response.failure) throw response.failure;
    const failedResponse =
      code === 1 &&
      response.output.indexOf(10) >= 0 &&
      JSON.parse(response.output.subarray(0, response.output.indexOf(10)).toString('utf8'))
        ?.status === 'error';
    assert(code === 0 || failedResponse, 'FILE_NATIVE_FAILED', '原生文件操作未返回已确认结果。');
    return response.output;
  } finally {
    response.close();
    deadline.removeEventListener('abort', response.abort);
    child.stdin.destroy();
  }
}

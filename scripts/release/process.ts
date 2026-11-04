import { spawn } from 'node:child_process';

export function run(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeout?: number;
    windowsVerbatimArguments?: boolean;
  } = {},
) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      windowsHide: true,
      windowsVerbatimArguments: options.windowsVerbatimArguments ?? false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let errorOutput = '';
    child.stdout.on('data', (data: Buffer) => {
      output = (output + data.toString()).slice(-1024 * 1024);
    });
    child.stderr.on('data', (data: Buffer) => {
      errorOutput = (errorOutput + data.toString()).slice(-16000);
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeout ?? 120000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(`${command} failed (${code}): ${errorOutput}`));
    });
  });
}

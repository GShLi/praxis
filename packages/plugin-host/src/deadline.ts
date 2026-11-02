import { PraxisError } from '@praxis/contracts';

export async function deadline<T>(action: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      action,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new PraxisError('PLUGIN_TIMEOUT', '插件操作超过时间限制。')),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

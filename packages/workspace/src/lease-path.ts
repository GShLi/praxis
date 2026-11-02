import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const defaultLeaseExecutable = process.env.PRAXIS_NATIVE_DIR
  ? path.join(
      process.env.PRAXIS_NATIVE_DIR,
      `praxis-lease${process.platform === 'win32' ? '.exe' : ''}`,
    )
  : fileURLToPath(
      new URL(
        `${import.meta.url.endsWith('.mjs') ? '../../' : '../../../'}build/native/praxis-lease${process.platform === 'win32' ? '.exe' : ''}`,
        import.meta.url,
      ),
    );

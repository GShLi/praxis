import { homedir } from 'node:os';
import path from 'node:path';
export const commonData =
  process.platform === 'darwin'
    ? path.join(homedir(), 'Library', 'Application Support', 'Praxis')
    : process.platform === 'win32'
      ? path.join(process.env.LOCALAPPDATA ?? homedir(), 'Praxis')
      : path.join(process.env.XDG_DATA_HOME ?? path.join(homedir(), '.local', 'share'), 'praxis');
export const baseData = process.env.PRAXIS_DATA_DIR ?? commonData;

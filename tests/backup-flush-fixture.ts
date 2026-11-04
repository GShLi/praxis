/** Emulate Windows' writable-handle flush contract inside the real, bundled backup worker. */
export const windowsFlushGuard = `
import backupFs from 'node:fs';
import { syncBuiltinESMExports as syncBackupBuiltins } from 'node:module';
import { parentPort as backupProbePort, workerData as backupProbeData } from 'node:worker_threads';
const backupOpen = backupFs.openSync;
const backupClose = backupFs.closeSync;
const backupSync = backupFs.fsyncSync;
const backupDescriptors = new Map();
let backupFlushFd, backupFlushFlags, backupFlushAttempts = 0, backupFlushClosed = false;
backupFs.openSync = (...args) => {
  const fd = backupOpen(...args);
  backupDescriptors.set(fd, args[1]);
  return fd;
};
backupFs.fsyncSync = (fd) => {
  backupFlushAttempts++;
  backupFlushFd = fd;
  backupFlushFlags = backupDescriptors.get(fd);
  if (!(backupFlushFlags & (backupFs.constants.O_WRONLY | backupFs.constants.O_RDWR)))
    throw Object.assign(new Error('private snapshot path: read-only flush'), { code: 'EPERM' });
  if (backupProbeData.failFlush)
    throw Object.assign(new Error('private snapshot path: injected disk failure'), { code: 'EIO' });
  backupSync(fd);
};
backupFs.closeSync = (fd) => {
  backupClose(fd);
  if (fd === backupFlushFd) backupFlushClosed = true;
  backupDescriptors.delete(fd);
};
syncBackupBuiltins();
const backupPost = backupProbePort.postMessage.bind(backupProbePort);
backupProbePort.postMessage = (result) => backupPost({ ...result, probe: {
  attempts: backupFlushAttempts, flags: backupFlushFlags, closed: backupFlushClosed,
} });
`;

import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  initializeSchema,
  PROTOCOL,
  assert,
  PraxisError,
} from '../../../packages/contracts/src/index.ts';
import { JsonLines, serveRpc } from '../../../packages/transport/src/index.ts';

const channel = new JsonLines(process.stdin, process.stdout);
const instanceId = randomUUID();
let initialized = false;
let lastHeartbeat = performance.now();
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(watchdog);
  channel.close();
  process.stdin.pause();
  process.stdout.end(() => process.exit(0));
}
const watchdog = setInterval(() => {
  if (performance.now() - lastHeartbeat > 15_000 || process.ppid === 1) shutdown();
}, 1000);
channel.on('close', shutdown);
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
serveRpc(channel, (method, params) => {
  if (method === 'host/initialize') {
    assert(!initialized, 'ALREADY_INITIALIZED', 'Host 已初始化。');
    const input = initializeSchema.parse(params);
    assert(input.protocolMajor === PROTOCOL.major, 'PROTOCOL_MISMATCH', 'Host 协议主版本不兼容。');
    initialized = true;
    lastHeartbeat = performance.now();
    return {
      ...PROTOCOL,
      hostInstanceId: instanceId,
      nonce: input.nonce,
      capabilities: ['diagnostics'],
      storageVersion: 1,
    };
  }
  assert(initialized, 'NOT_INITIALIZED', '请先初始化 Host。');
  if (method === 'host/ping') {
    lastHeartbeat = performance.now();
    return { ok: true };
  }
  if (method === 'host/shutdown') {
    setImmediate(shutdown);
    return { accepted: true };
  }
  if (method === 'host/diagnostics')
    return {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      protocol: PROTOCOL,
      agentAvailable: false,
    };
  throw new PraxisError('METHOD_NOT_FOUND', '此 Host 不支持该方法。');
});

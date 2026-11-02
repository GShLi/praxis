import { assert } from '@praxis/contracts';
export function serverConfig() {
  const origin = process.env.PRAXIS_PUBLIC_ORIGIN ?? 'http://127.0.0.1:4310';
  const parsed = new URL(origin);
  assert(
    parsed.origin === origin && !parsed.username && !parsed.password,
    'INVALID_ORIGIN',
    '公共来源只能包含协议、主机和端口。',
  );
  assert(
    parsed.protocol === 'https:' || ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname),
    'TLS_REQUIRED',
    '非本机部署必须使用 HTTPS 来源。',
  );

  const port = Number(process.env.PRAXIS_PORT ?? 4310);
  assert(
    Number.isInteger(port) && port > 0 && port <= 65535,
    'INVALID_PORT',
    '服务端口必须为 1–65535。',
  );
  return { origin, port, hostname: process.env.PRAXIS_BIND ?? '127.0.0.1' };
}

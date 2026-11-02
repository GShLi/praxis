import { safeError } from '@praxis/contracts';
import { JsonLines } from './json-lines.ts';
import type { Handler } from './rpc-schema.ts';
import { requestSchema } from './rpc-schema.ts';

export function serveRpc(channel: JsonLines, handler: Handler) {
  channel.on('frame', (raw: unknown) => {
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) {
      channel.send({
        jsonrpc: '2.0',
        id: null,
        error: { code: 'INVALID_REQUEST', safeMessage: '无效 RPC 请求。' },
      });
      return;
    }
    const { method, params, id } = parsed.data;
    void Promise.resolve()
      .then(() => handler(method, params))
      .then(
        (result) => {
          if (id !== undefined) channel.send({ jsonrpc: '2.0', id, result: result ?? null });
        },
        (error: unknown) => {
          if (id !== undefined) channel.send({ jsonrpc: '2.0', id, error: safeError(error) });
        },
      )
      .catch(() => channel.close());
  });
}

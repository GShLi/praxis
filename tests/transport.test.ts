import { startHost } from '@praxis/client-host';
import { MAX_FRAME_BYTES } from '@praxis/contracts';
import { JsonLines, RpcClient, serveRpc } from '@praxis/transport';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

test('RPC accepts split UTF-8 frames and control requests while another request is pending', async () => {
  const up = new PassThrough(),
    down = new PassThrough();
  const server = new JsonLines(up, down),
    client = new RpcClient(new JsonLines(down, up));
  let finish!: (value: unknown) => void;
  serveRpc(server, (method) =>
    method === 'slow'
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : '你好',
  );
  const pending = client.request('slow');
  assert.equal(await client.request('ping'), '你好');
  finish('done');
  assert.equal(await pending, 'done');
  client.channel.close();
  server.close();
});
test('oversized frame closes without waiting for a newline', async () => {
  const input = new PassThrough();
  const channel = new JsonLines(input, new PassThrough());
  const closed = once(channel, 'close');
  input.write(Buffer.alloc(MAX_FRAME_BYTES + 1, 65));
  await closed;
});
test('native child Host handshakes and exits on explicit shutdown', async () => {
  const host = await startHost('cli');
  try {
    const result = await host.rpc.request<{ platform: string }>('host/diagnostics');
    assert.equal(result.platform, process.platform);
  } finally {
    await host.close();
  }
});

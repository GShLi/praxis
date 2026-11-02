import { createServer } from 'node:http';
interface RemoteFixture {
  legacy: boolean;
  description: string;
  isError: boolean;
  invalidOutput: boolean;
  disconnect: boolean;
  inputRequired: boolean;
  beforeList?: (() => Promise<void>) | undefined;
  beforeCall?: (() => Promise<void>) | undefined;
}
export async function mcpHttpFixture(legacy = false) {
  const requests: Array<{
    method: string;
    headers: Record<string, unknown>;
    params: Record<string, unknown>;
  }> = [];
  const remote = {
    legacy,
    description: 'Echo fixture',
    isError: false,
    invalidOutput: false,
    disconnect: false,
    inputRequired: false,
    beforeList: undefined as (() => Promise<void>) | undefined,
    beforeCall: undefined as (() => Promise<void>) | undefined,
  };
  const server = createServer((request, response) => {
    void handle(requests, remote, request, response).catch(() => {
      response.writeHead(500);
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fixture address');
  return {
    endpoint: `http://127.0.0.1:${address.port}/mcp`,
    requests,
    remote,
    async close() {
      const stopped = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      await stopped;
    },
  };
}

async function handle(
  requests: Array<{
    method: string;
    headers: Record<string, unknown>;
    params: Record<string, unknown>;
  }>,
  remote: RemoteFixture,

  request: import('node:http').IncomingMessage,
  response: import('node:http').ServerResponse,
) {
  if (request.method !== 'POST') {
    response.writeHead(405);
    response.end();
    return;
  }
  let body = '';
  for await (const part of request) body += String(part);
  const rpc = JSON.parse(body) as { id: string; method: string; params: Record<string, unknown> };
  requests.push({ method: rpc.method, params: rpc.params, headers: request.headers });
  if (rpc.method === 'notifications/initialized') {
    response.writeHead(202);
    response.end();
    return;
  }
  let result: object;
  if (rpc.method === 'initialize')
    result = {
      protocolVersion: '2025-11-25',
      capabilities: { tools: {} },
      serverInfo: { name: 'legacy-fixture', version: '1.0' },
    };
  else if (rpc.method === 'server/discover')
    result = { supportedVersions: ['2026-07-28'], capabilities: { tools: {} } };
  else if (rpc.method === 'tools/list') {
    await remote.beforeList?.();
    result = { tools: [echoDefinition(remote)] };
  } else if (rpc.method === 'tools/call') {
    await remote.beforeCall?.();
    if (remote.disconnect) {
      request.socket.destroy();
      return;
    }
    result = echoResult(remote);
  } else throw new Error(`Unexpected request ${rpc.method}`);
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(
    JSON.stringify({
      jsonrpc: '2.0',
      id: rpc.id,
      result: remote.legacy
        ? result
        : { resultType: 'complete', ttlMs: 0, cacheScope: 'private', ...result },
    }),
  );
}

function echoDefinition(remote: RemoteFixture) {
  return {
    name: 'echo',
    description: remote.description,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { text: { type: 'string', 'x-mcp-header': 'text' } },
      required: ['text'],
    },
    outputSchema: remote.legacy
      ? { type: 'object', properties: { value: { type: 'boolean' } }, required: ['value'] }
      : { type: 'boolean' },
  };
}

function echoResult(remote: RemoteFixture) {
  let result: object = {
    content: [{ type: 'text', text: 'echo result' }],
    isError: remote.isError,
    structuredContent: remote.invalidOutput
      ? 'bad schema'
      : remote.legacy
        ? { value: false }
        : false,
  };
  if (remote.inputRequired)
    result = {
      resultType: 'input_required',
      requestState: 'private-resume-state',
      inputRequests: [],
    };
  return result;
}

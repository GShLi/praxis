import { LegacyForms } from './mcp-legacy-form.ts';
import { promptFixture, promptReply } from './mcp-prompts.ts';
import { createServer } from 'node:http';
import { resourceReply, resourcesFixture, type ResourceFixture } from './mcp-resources.ts';
interface RemoteFixture {
  legacy: boolean;
  legacyForms: LegacyForms;
  prompts: ReturnType<typeof promptFixture> | undefined;
  resources: ResourceFixture | undefined;
  description: string;
  isError: boolean;
  invalidOutput: boolean;
  disconnect: boolean;
  inputRequired: boolean;
  repeatInput: boolean;
  stateOnly: boolean;
  form: Record<string, unknown>;
  beforeList?: (() => Promise<void>) | undefined;
  beforeCall?: (() => Promise<void>) | undefined;
}
export async function mcpHttpFixture(legacy = false, resources = false, prompts = false) {
  const requests: Array<{
    id: string;
    method: string;
    headers: Record<string, unknown>;
    params: Record<string, unknown>;
  }> = [];
  const remote = {
    legacy,
    legacyForms: new LegacyForms(),
    prompts: prompts ? promptFixture() : undefined,
    resources: resources ? resourcesFixture() : undefined,
    description: 'Echo fixture',
    isError: false,
    invalidOutput: false,
    disconnect: false,
    inputRequired: false,
    repeatInput: false,
    stateOnly: false,
    form: {
      type: 'object',
      properties: { city: { type: 'string', description: '目的城市' } },
      required: ['city'],
    } as Record<string, unknown>,
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
    id: string;
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
  const rpc = JSON.parse(body) as {
    id: string;
    method: string;
    params: Record<string, unknown>;
    result?: unknown;
    error?: unknown;
  };
  if (!rpc.method) {
    remote.legacyForms.reply(String(rpc.id), rpc.result ?? rpc.error);
    response.writeHead(202);
    response.end();
    return;
  }
  requests.push({
    id: String(rpc.id),
    method: rpc.method,
    params: rpc.params,
    headers: request.headers,
  });
  if (rpc.method === 'notifications/initialized') {
    response.writeHead(202);
    response.end();
    return;
  }
  let result: object;
  const capabilities = {
    tools: {},
    ...(remote.resources ? { resources: {} } : {}),
    ...(remote.prompts ? { prompts: {} } : {}),
  };
  if (rpc.method === 'initialize')
    result = {
      protocolVersion: '2025-11-25',
      capabilities,
      serverInfo: { name: 'legacy-fixture', version: '1.0' },
    };
  else if (rpc.method === 'server/discover')
    result = {
      supportedVersions: ['2026-07-28'],
      capabilities,
    };
  else if (remote.prompts && rpc.method.startsWith('prompts/'))
    result =
      rpc.method === 'prompts/get' && remote.inputRequired && !rpc.params.inputResponses
        ? echoResult(remote, rpc.params)
        : await promptReply(remote.prompts, rpc.method, rpc.params);
  else if (remote.resources && rpc.method.startsWith('resources/'))
    result = await resourceReply(remote.resources, rpc.method, rpc.params);
  else if (rpc.method === 'tools/list') {
    await remote.beforeList?.();
    result = { tools: [echoDefinition(remote)] };
  } else if (rpc.method === 'tools/call') {
    await remote.beforeCall?.();
    if (remote.disconnect) {
      request.socket.destroy();
      return;
    }
    if (remote.legacy && remote.inputRequired) {
      const answer = await remote.legacyForms.ask(response, remote.form);
      result = echoResult(remote, { ...rpc.params, inputResponses: { details: answer } });
    } else result = echoResult(remote, rpc.params);
  } else throw new Error(`Unexpected request ${rpc.method}`);
  const message = JSON.stringify({
    jsonrpc: '2.0',
    id: rpc.id,
    result: remote.legacy
      ? result
      : { resultType: 'complete', ttlMs: 0, cacheScope: 'private', ...result },
  });
  if (response.destroyed) return;
  if (response.headersSent) response.end('event: message\ndata: ' + message + '\n\n');
  else {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(message);
  }
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

function echoResult(remote: RemoteFixture, params: Record<string, unknown>) {
  let result: object = {
    content: [{ type: 'text', text: 'echo result' }],
    isError: remote.isError,
    structuredContent: remote.invalidOutput
      ? 'bad schema'
      : remote.legacy
        ? { value: false }
        : false,
  };
  if (
    remote.inputRequired &&
    ((remote.stateOnly ? !params.requestState : !params.inputResponses) || remote.repeatInput)
  )
    result = {
      resultType: 'input_required',
      requestState: 'private-resume-state',
      inputRequests: remote.stateOnly
        ? {}
        : {
            details: {
              method: 'elicitation/create',
              params: { mode: 'form', message: '补充任务信息', requestedSchema: remote.form },
            },
          },
    };
  return result;
}

import type { startHost } from '@praxis/client-host';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function installProvider(host: Awaited<ReturnType<typeof startHost>>, root: string) {
  const source = path.join(root, 'plugin');
  await mkdir(source);
  await writeFile(
    path.join(source, 'praxis-plugin.json'),
    JSON.stringify({
      id: 'fixture.prompt',
      version: '1.0.0',
      sdkVersion: '^1.0.0',
      entry: 'plugin.mjs',
      runtimes: ['local-host'],
      modes: ['agent'],
      platforms: ['darwin', 'linux', 'win32'],
      capabilities: ['model-provider'],
    }),
  );
  await writeFile(
    path.join(source, 'plugin.mjs'),
    `export default {activate(ctx){ctx.registerProvider('model',{async complete(request){
    const message=request.messages.findLast(m=>m.role==='user');
    if(!message.content.includes('外部模板') || !message.content.includes('Create a hello page')) throw new Error('missing selected material');
    request.onDelta('Template applied');
    return {message:{id:'fixture',role:'assistant',content:'Template applied'},usage:{input:1,output:1},finishReason:'stop'};
  }});}}`,
  );
  const review = await host.rpc.request<{ digest: string }>('plugin/inspect', { source });
  await host.rpc.request('plugin/install', {
    source,
    expectedDigest: review.digest,
    expectedRevision: 0,
  });
  await host.rpc.request('plugin/set-enabled', {
    id: 'fixture.prompt',
    enabled: true,
    expectedRevision: 1,
  });
}

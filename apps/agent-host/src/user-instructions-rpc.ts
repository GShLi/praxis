import { assert, saveUserInstructionsSchema } from '@praxis/contracts';
import type { HostIdentity } from './identity.ts';
import { noArgs, type RpcRoutes } from './rpc-schema.ts';

export function userInstructionsRoutes(identity: HostIdentity): RpcRoutes {
  async function configuration() {
    const { auth } = identity.require(),
      settings = identity.userInstructions;
    assert(settings, 'CONFIG_UNAVAILABLE', '用户设置尚未打开。');
    await auth.profile(
      AbortSignal.any([identity.discoveryScope.signal, AbortSignal.timeout(15000)]),
    );
    assert(
      identity.require().auth === auth && identity.userInstructions === settings,
      'UNAUTHENTICATED',
      '登录身份已变化。',
    );
    return settings;
  }
  return {
    'user-instructions/read': async (params) => {
      noArgs.parse(params);
      return (await configuration()).read();
    },
    'user-instructions/save': async (params) => {
      const input = saveUserInstructionsSchema.parse(params);
      return (await configuration()).save(input);
    },
  };
}

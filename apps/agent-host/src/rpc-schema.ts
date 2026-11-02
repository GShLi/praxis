import { idSchema } from '@praxis/contracts';
import { z } from 'zod';
export const noArgs = z.strictObject({});
export const sessionArg = z.strictObject({ sessionId: idSchema });
export type RpcRoutes = Record<string, (params: unknown) => unknown | Promise<unknown>>;

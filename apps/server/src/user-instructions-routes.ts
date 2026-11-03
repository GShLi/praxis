import type { AuthService } from '@praxis/auth';
import { UserInstructionRepository } from '@praxis/storage-server';
import type { HttpApp } from './http-types.ts';

export function registerUserInstructions(app: HttpApp, auth: AuthService) {
  const settings = new UserInstructionRepository(auth.database);
  app.get('/v1/preferences/instructions', async (c) => {
    const identity = c.get('identity');
    auth.require(identity, 'chats:read');
    return c.json(await settings.read(identity.userId));
  });
  app.put('/v1/preferences/instructions', async (c) => {
    const identity = c.get('identity');
    auth.require(identity, 'chats:write');
    return c.json(await settings.save(identity.userId, await c.req.json()));
  });
}

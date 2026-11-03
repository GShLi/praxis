import type { AuthService, Identity } from '@praxis/auth';
import type { ChatRuntime } from '@praxis/chat-runtime';
import type { DiagnosticLog } from '@praxis/diagnostics';
import { discoverModels } from '@praxis/model-core/catalog';
import { Hono } from 'hono';
import { registerAccount } from './account-routes.ts';
import { registerChat } from './chat-routes.ts';
import { registerEvents } from './events-routes.ts';
import { registerIdentity } from './identity-routes.ts';
import { registerMiddleware } from './middleware-routes.ts';
import { registerProviders } from './providers-routes.ts';
import { registerPublicAuth } from './public-auth-routes.ts';
import { registerWebAssets } from './web-assets.ts';
import { webSecurity } from './web-security.ts';
import { registerUserInstructions } from './user-instructions-routes.ts';

export function createApp(
  auth: AuthService,
  chat: ChatRuntime,
  publicOrigin: string,
  webRoot?: string,
  catalog: typeof discoverModels = discoverModels,
  diagnostics?: Pick<DiagnosticLog, 'record'>,
) {
  const security = webSecurity(new URL(publicOrigin).origin);
  const app = new Hono<{ Variables: { identity: Identity } }>();
  registerMiddleware(app, auth, diagnostics);
  registerPublicAuth(app, auth, security);
  registerIdentity(app, auth, security);
  registerAccount(app, auth, security.secure);
  registerUserInstructions(app, auth);
  registerProviders(app, auth, catalog);
  registerChat(app, auth, chat);
  registerEvents(app, auth, chat);
  registerWebAssets(app, webRoot);
  return app;
}

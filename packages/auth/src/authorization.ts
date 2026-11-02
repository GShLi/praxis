import { assert } from '@praxis/contracts';
import type { Identity, Scope } from './identity.ts';
export function requireScope(identity: Identity, scope: Scope) {
  assert(identity.scopes.includes(scope), 'FORBIDDEN', '此凭据没有所需权限。');
}

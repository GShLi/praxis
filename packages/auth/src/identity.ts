export const scopes = [
  'profile:read',
  'providers:read',
  'providers:write',
  'client:direct',
  'chats:read',
  'chats:write',
  'keys:write',
] as const;

export type Scope = (typeof scopes)[number];

export interface Identity {
  userId: string;
  sessionId: string;
  username: string;
  admin: boolean;
  scopes: Scope[];
  kind: 'web' | 'access' | 'api-key';
  csrfHash?: string;
}

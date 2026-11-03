import { z } from 'zod';
export const oauthMetadataSchema = z.object({
  issuer: z.string().url(),
  authorization_endpoint: z.string().url(),
  token_endpoint: z.string().url(),
  response_types_supported: z.array(z.string()).max(32),
  code_challenge_methods_supported: z.array(z.string()).max(16),
  token_endpoint_auth_methods_supported: z.array(z.string()).max(16).optional(),
  authorization_response_iss_parameter_supported: z.boolean().optional(),
  client_id_metadata_document_supported: z.boolean().optional(),
});
export const oauthAccountSchema = z.strictObject({
  version: z.literal(1),
  state: z.enum(['ready', 'refreshing']),
  issuer: z.string().url(),
  resource: z.string().url(),
  clientId: z.string().min(1).max(2048),
  redirectUri: z.string().url(),
  scopes: z.array(z.string().max(256)).max(32),
  allowPrivateIssuer: z.boolean(),
  metadata: oauthMetadataSchema,
  accessToken: z
    .string()
    .min(1)
    .max(8192)
    .regex(/^[\x21-\x7e]+$/),
  refreshToken: z.string().min(1).max(16384).optional(),
  expiresAt: z.number().nonnegative().nullable(),
  authEpoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
export type OAuthAccount = z.infer<typeof oauthAccountSchema>;
export type OAuthMetadata = z.infer<typeof oauthMetadataSchema>;

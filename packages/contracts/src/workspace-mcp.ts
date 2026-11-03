import { z } from 'zod';

export const workspaceMcpSchema = z.strictObject({
  servers: z
    .array(
      z.strictObject({
        serverId: z.uuid(),
        tools: z
          .array(
            z
              .string()
              .min(1)
              .max(256)
              .regex(/^[^\x00-\x1f\x7f]+$/),
          )
          .max(128)
          .refine((names) => new Set(names).size === names.length, '工具名不能重复。')
          .optional(),
      }),
    )
    .max(32)
    .refine(
      (servers) => new Set(servers.map((server) => server.serverId)).size === servers.length,
      '服务器 ID 不能重复。',
    ),
});
export type WorkspaceMcpConfig = z.infer<typeof workspaceMcpSchema>;

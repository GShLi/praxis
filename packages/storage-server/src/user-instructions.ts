import {
  assert,
  saveUserInstructionsSchema,
  userInstructionSettingsSchema,
  type UserInstructionSettings,
} from '@praxis/contracts';
import type { ServerDatabase } from './types.ts';

export class UserInstructionRepository {
  constructor(private database: ServerDatabase) {}
  async read(owner: string): Promise<UserInstructionSettings> {
    const row = (
      await this.database.query<{ revision: number; value: unknown }>(
        'SELECT revision,document AS value FROM user_instructions WHERE owner=$1',
        [owner],
      )
    ).rows[0];
    return userInstructionSettingsSchema.parse(
      row ?? { revision: 0, value: { enabled: false, text: '' } },
    );
  }
  async save(owner: string, raw: unknown): Promise<UserInstructionSettings> {
    const input = saveUserInstructionsSchema.parse(raw);
    return this.database.transaction(async (sql) => {
      const result =
        input.expectedRevision === 0
          ? await sql.query<{ revision: number }>(
              'INSERT INTO user_instructions(owner,revision,document) VALUES($1,1,$2) ON CONFLICT(owner) DO NOTHING RETURNING revision',
              [owner, JSON.stringify(input.value)],
            )
          : await sql.query<{ revision: number }>(
              'UPDATE user_instructions SET revision=revision+1,document=$2 WHERE owner=$1 AND revision=$3 RETURNING revision',
              [owner, JSON.stringify(input.value), input.expectedRevision],
            );
      const revision = result.rows[0]?.revision;
      assert(revision, 'CONFIG_CONFLICT', '用户指令已修改，请刷新后重试。');
      await sql.query(
        "INSERT INTO audit_events(actor,operation,outcome) VALUES($1,'user-instructions/save','success')",
        [owner],
      );
      return { revision, value: input.value };
    });
  }
}

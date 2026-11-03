import { assert, saveUserInstructionsSchema, userInstructionsSchema } from '@praxis/contracts';
import path from 'node:path';
import { ConfigFile } from './config-file.ts';

/** Owned by one authenticated profile; the Host's writer lease protects the file. */
export class UserInstructionConfig {
  private file: ConfigFile<ReturnType<typeof userInstructionsSchema.parse>>;
  private closing = false;
  constructor(directory: string) {
    this.file = new ConfigFile(
      path.join(directory, 'user-instructions.json'),
      (raw) => userInstructionsSchema.parse(raw),
      { enabled: false, text: '' },
    );
  }
  read() {
    assert(!this.closing, 'CONFIG_CLOSED', '用户设置正在关闭。');
    return this.file.read();
  }
  save(raw: unknown) {
    const input = saveUserInstructionsSchema.parse(raw);
    return this.file.update(input.expectedRevision, () => input.value);
  }
  close() {
    this.closing = true;
    return this.file.close();
  }
}

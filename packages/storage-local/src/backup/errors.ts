import { PraxisError } from '@praxis/contracts';
export class BackupRestoreError extends PraxisError {
  constructor(readonly rollbackDirectory: string) {
    super(
      'BACKUP_RESTORE_UNKNOWN',
      '恢复结果未确认；数据库可能已恢复。请检查会话，必要时使用回退备份，不要自动重试。',
    );
  }
}

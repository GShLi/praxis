import type { UserCommand } from '@praxis/contracts';
export interface InputRow {
  command?: UserCommand;
  id: string;
  sessionId: string;
  requestId: string;
  mode: 'queue' | 'steer';
  text: string;
  state: string;
  expectedTurnId: string | null;
  acceptedSeq: number;
}

export type Row = Record<string, string | number | null>;

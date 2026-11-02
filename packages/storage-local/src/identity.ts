import { createHash, randomUUID } from 'node:crypto';

export const uuid = () => randomUUID();

export const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

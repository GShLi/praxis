export type SecretStorage = 'os' | 'memory';
export interface SecretBackend {
  set(key: string, value: string, signal: AbortSignal): Promise<void>;
  get(key: string, signal: AbortSignal): Promise<string | undefined>;
  delete(key: string, signal: AbortSignal): Promise<void>;
}

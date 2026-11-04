type Draft = { text: string; revision: number };
type DraftStorage = Pick<Storage, 'getItem' | 'setItem'>;
export type DraftReceipt = { entry: Draft; revision: number; text: string };

/** UI drafts are account-scoped caches; session history remains authoritative. */
export class ConversationDrafts {
  private entries = new Map<string, Draft>();
  private storageKey: string;
  persistent: boolean;
  constructor(
    private storage: DraftStorage | undefined,
    scope: string,
  ) {
    this.storageKey = `praxis-drafts-v1:${scope}`;
    this.persistent = Boolean(storage);
    try {
      const value: unknown = JSON.parse(storage?.getItem(this.storageKey) ?? '{}');
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [key, text] of Object.entries(value)) {
          if (typeof text === 'string') this.entries.set(key, { text, revision: 0 });
        }
      }
    } catch {
      // A malformed or unavailable UI cache must not prevent starting a conversation.
      this.persistent = false;
    }
  }
  read(key: string) {
    return this.entries.get(key)?.text ?? '';
  }
  write(key: string, text: string) {
    const entry = this.entry(key);
    entry.text = text;
    entry.revision++;
    this.persist();
  }
  capture(key: string): DraftReceipt {
    const entry = this.entry(key);
    return { entry, revision: entry.revision, text: entry.text };
  }
  acknowledge(receipt: DraftReceipt) {
    if (receipt.entry.revision !== receipt.revision) return;
    receipt.entry.text = '';
    receipt.entry.revision++;
    this.persist();
  }
  move(from: string, to: string) {
    if (from === to || this.read(to)) return;
    this.entries.set(to, this.entry(from));
    this.entries.delete(from);
    this.persist();
  }
  private entry(key: string) {
    let value = this.entries.get(key);
    if (!value) {
      value = { text: '', revision: 0 };
      this.entries.set(key, value);
    }
    return value;
  }
  private persist() {
    try {
      this.storage?.setItem(
        this.storageKey,
        JSON.stringify(
          Object.fromEntries(
            [...this.entries]
              .filter(([, value]) => value.text)
              .map(([key, value]) => [key, value.text]),
          ),
        ),
      );
      this.persistent = Boolean(this.storage);
    } catch {
      // Keep the in-memory draft when browser storage is denied or full.
      this.persistent = false;
    }
  }
}

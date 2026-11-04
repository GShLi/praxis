export type FeedbackVariant = 'info' | 'success' | 'error';
export interface SettingsFeedback {
  message: string;
  variant: FeedbackVariant;
  target?: string;
}
export interface ResourceSnapshot<T> {
  data: T | null;
  status: 'loading' | 'ready' | 'error' | 'unsupported';
  error: string;
  busy: boolean;
  feedback: SettingsFeedback;
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : '操作失败，请重试。';

/** Owns one settings list and serializes writes against its authoritative revision. */
export class SettingsResource<T> {
  private epoch = 0;
  private active = false;
  private locked = false;
  private listeners = new Set<() => void>();
  private snapshot: ResourceSnapshot<T>;

  constructor(private readonly read: (() => Promise<T>) | undefined) {
    this.snapshot = {
      data: null,
      status: read ? 'loading' : 'unsupported',
      error: '',
      busy: false,
      feedback: { message: '', variant: 'info' },
    };
  }

  getSnapshot = () => this.snapshot;
  clearFeedback = () => {
    if (this.active && !this.locked) this.publish({ feedback: { message: '', variant: 'info' } });
  };
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  activate() {
    this.active = true;
    this.locked = false;
    this.epoch++;
  }
  dispose() {
    this.active = false;
    this.locked = false;
    this.epoch++;
  }
  private publish(update: Partial<ResourceSnapshot<T>>) {
    this.snapshot = { ...this.snapshot, ...update };
    this.listeners.forEach((listener) => listener());
  }
  private current(epoch: number) {
    return this.active && epoch === this.epoch;
  }

  reload = async () => {
    if (!this.active || this.locked || !this.read) return false;
    const epoch = this.epoch;
    this.locked = true;
    this.publish({ status: 'loading', error: '', busy: true });
    try {
      const data = await this.read();
      if (!this.current(epoch)) return false;
      this.publish({ data, status: 'ready', feedback: { message: '', variant: 'info' } });
      return true;
    } catch (error) {
      if (this.current(epoch)) this.publish({ status: 'error', error: errorMessage(error) });
      return false;
    } finally {
      if (this.current(epoch)) {
        this.locked = false;
        this.publish({ busy: false });
      }
    }
  };

  /** A successful write stays committed even if its subsequent list refresh fails. */
  run = async (
    operation: () => Promise<string>,
    target?: string,
    refresh = true,
  ): Promise<boolean> => {
    if (!this.active || this.locked || this.snapshot.status !== 'ready') return false;
    const epoch = this.epoch;
    this.locked = true;
    this.publish({ busy: true, feedback: { message: '', variant: 'info' } });
    let committed = false;
    let message = '';
    try {
      message = await operation();
      committed = true;
    } catch (error) {
      message = errorMessage(error);
    }
    if (!this.current(epoch)) return false;
    let refreshError = '';
    if (refresh && this.read) {
      try {
        const data = await this.read();
        if (this.current(epoch)) this.publish({ data, status: 'ready', error: '' });
      } catch (error) {
        refreshError = errorMessage(error);
        if (this.current(epoch)) this.publish({ status: 'error', error: refreshError });
      }
    }
    if (!this.current(epoch)) return false;
    this.locked = false;
    this.publish({
      busy: false,
      feedback: {
        message: refreshError ? `${message} 列表刷新失败，请重试读取以确认当前状态。` : message,
        variant: committed && !refreshError ? 'success' : 'error',
        ...(target ? { target } : {}),
      },
    });
    return committed;
  };
}

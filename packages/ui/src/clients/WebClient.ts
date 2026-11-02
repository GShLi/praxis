import type { Event } from '@praxis/contracts';
import type { AvailableModel, ModelDiscoveryInput } from '@praxis/model-core/provider';
import type {
  ApiKeyInfo,
  PraxisClient,
  Profile,
  Provider,
  Snapshot,
  ViewMessage,
} from '../client-types.ts';

export class WebClient implements PraxisClient {
  desktop = false;
  private csrf = '';
  private pageId = crypto.randomUUID();
  private runs = new Map<
    string,
    { generationId: string; lease: string; timer: ReturnType<typeof setInterval> }
  >();
  private refreshing: Promise<void> | undefined;
  async request<T>(path: string, method = 'GET', body?: unknown, retry = true): Promise<T> {
    // CSRF is session-bound and shared by same-origin tabs; never persisted in localStorage.
    const cookie = document.cookie.split('; ').find((v) => v.startsWith('praxis_csrf='));
    if (cookie) this.csrf = decodeURIComponent(cookie.slice('praxis_csrf='.length));
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-csrf-token': this.csrf },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 401 && retry && !path.startsWith('/v1/auth/')) {
      this.refreshing ??= (async () => {
        const renew = async () => {
          // Another tab may have rotated cookies while this tab was waiting for the lock.
          const me = await fetch('/v1/me', { credentials: 'same-origin' });
          if (me.ok) {
            this.csrf = ((await me.json()) as { csrfToken: string }).csrfToken;
            return;
          }
          const result = await this.request<{ csrfToken: string }>(
            '/v1/auth/refresh',
            'POST',
            {},
            false,
          );
          this.csrf = result.csrfToken;
        };
        if (navigator.locks) await navigator.locks.request('praxis-cookie-refresh', renew);
        else await renew();
      })().finally(() => {
        this.refreshing = undefined;
      });
      await this.refreshing;
      return this.request<T>(path, method, body, false);
    }
    const result = (await response.json()) as T & { safeMessage?: string };
    if (!response.ok) throw new Error(result.safeMessage ?? `请求失败（${response.status}）`);
    return result;
  }
  async current() {
    try {
      const me = await this.request<{ csrfToken: string }>('/v1/me');
      this.csrf = me.csrfToken;
      return true;
    } catch {
      return false;
    }
  }
  async login(input: { username: string; password: string }) {
    const result = await this.request<{ csrfToken: string }>('/v1/auth/login', 'POST', {
      username: input.username,
      password: input.password,
      kind: 'web',
    });
    this.csrf = result.csrfToken;
  }
  async logout() {
    for (const [id] of this.runs) await this.cancel(id);
    await this.request('/v1/auth/logout', 'POST', {});
    this.csrf = '';
  }
  providers() {
    return this.request<Provider[]>('/v1/providers');
  }
  discoverModels(input: ModelDiscoveryInput) {
    return this.request<AvailableModel[]>('/v1/providers/discover-models', 'POST', input);
  }
  async saveProvider(input: {
    config: Omit<Provider, 'id' | 'revision' | 'keyConfigured'>;
    apiKey?: string;
    id?: string;
    expectedRevision?: number;
  }) {
    await this.request(
      `/v1/providers${input.id ? '/' + encodeURIComponent(input.id) : ''}`,
      input.id ? 'PUT' : 'POST',
      {
        config: input.config,
        ...(input.apiKey ? { apiKey: input.apiKey } : {}),
        ...(input.id ? { expectedRevision: input.expectedRevision } : {}),
      },
    );
  }
  async list() {
    const rows =
      await this.request<Array<{ id: string; title: string; active_generation: string | null }>>(
        '/v1/chats',
      );
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      kind: 'chat' as const,
      status: row.active_generation ? 'running' : 'idle',
    }));
  }
  async create() {
    const row = await this.request<{ id: string; title: string }>('/v1/chats', 'POST', {});
    return { ...row, kind: 'chat' as const, status: 'idle' };
  }
  async read(id: string): Promise<Snapshot> {
    const result = await this.request<{
      chat: { id: string; title: string; active_generation: string | null };
      inputs: Array<{ id: string; content: string; selected_generation: string | null }>;
      generations: Array<{ id: string; input_id: string; status: string; content: string }>;
      throughSeq: number;
    }>(`/v1/chats/${id}/history`);
    const messages: ViewMessage[] = [];
    for (const input of result.inputs) {
      messages.push({ id: input.id, role: 'user', content: input.content });
      const candidates = result.generations.filter((g) => g.input_id === input.id);
      const selected =
        candidates.find((g) => g.id === input.selected_generation) ?? candidates.at(-1);
      if (selected)
        messages.push({
          id: selected.id,
          role: 'assistant',
          content: selected.content,
          status: selected.status,
        });
    }
    return {
      session: {
        id,
        title: result.chat.title,
        kind: 'chat',
        status: result.chat.active_generation ? 'running' : 'idle',
      },
      messages,
      throughSeq: result.throughSeq,
      turnId: result.chat.active_generation,
    };
  }
  private async submit(id: string, body: unknown, regenerate: boolean) {
    const result = await this.request<{ generationId: string; lease: string }>(
      `/v1/chats/${id}/${regenerate ? 'regenerate' : 'messages'}`,
      'POST',
      body,
    );
    const previous = this.runs.get(id);
    if (previous) clearInterval(previous.timer);
    const beat = () => {
      void this.request(`/v1/chats/${id}/generations/${result.generationId}/heartbeat`, 'POST', {
        pageId: this.pageId,
        lease: result.lease,
      }).catch(() => {
        const run = this.runs.get(id);
        if (run) clearInterval(run.timer);
        this.runs.delete(id);
      });
    };
    this.runs.set(id, { ...result, timer: setInterval(beat, 5000) });
    beat();
  }
  send(id: string, text: string, providerId: string) {
    return this.submit(
      id,
      { requestId: crypto.randomUUID(), text, providerId, pageId: this.pageId },
      false,
    );
  }
  regenerate(id: string, providerId: string) {
    return this.submit(
      id,
      { requestId: crypto.randomUUID(), providerId, pageId: this.pageId },
      true,
    );
  }
  async cancel(id: string) {
    const run = this.runs.get(id);
    const generation = run?.generationId ?? (await this.read(id)).turnId;
    if (generation)
      await this.request(`/v1/chats/${id}/generations/${generation}/cancel`, 'POST', {});
  }
  listen(
    id: string,
    after: number,
    event: (event: Event) => void,
    delta: (text: string) => void,
    failure: (error: Error) => void,
  ) {
    const source = new EventSource(
      `/v1/chats/${id}/events?afterSeq=${after}&pageId=${this.pageId}`,
    );
    source.addEventListener('session-event', (raw: MessageEvent<string>) => {
      const value = JSON.parse(raw.data) as Event;
      if (value.type === 'generation/finished') {
        const run = this.runs.get(id);
        if (run) clearInterval(run.timer);
        this.runs.delete(id);
      }
      event(value);
    });
    source.addEventListener('delta', (raw: MessageEvent<string>) =>
      delta((JSON.parse(raw.data) as { text: string }).text),
    );
    source.onerror = () => failure(new Error('连接中断，正在尝试恢复。'));
    return () => source.close();
  }
  profile() {
    return this.request<Profile>('/v1/me');
  }
  keys() {
    return this.request<ApiKeyInfo[]>('/v1/api-keys');
  }
  async revokeKey(id: string) {
    await this.request(`/v1/api-keys/${encodeURIComponent(id)}`, 'DELETE');
  }
  async deleteProvider(id: string, revision: number) {
    await this.request(`/v1/providers/${encodeURIComponent(id)}`, 'DELETE', {
      expectedRevision: revision,
    });
  }
  async createKey() {
    const result = await this.request<{ key: string }>('/v1/api-keys', 'POST', {
      name: 'Praxis 客户端',
      scopes: ['profile:read', 'providers:read', 'providers:write', 'client:direct'],
      days: 90,
    });
    return result.key;
  }
}

import type { ServerResponse } from 'node:http';
export class LegacyForms {
  private pending = new Map<string, (result: unknown) => void>();
  private next = 0;
  readonly answers: unknown[] = [];
  reply(id: string, result: unknown) {
    this.answers.push(result);
    this.pending.get(id)?.(result);
  }
  ask(response: ServerResponse, form: Record<string, unknown>) {
    const id = `form-${++this.next}`;
    return new Promise<unknown>((resolve) => {
      const finish = (value: unknown) => {
        clearTimeout(timer);
        this.pending.delete(id);
        response.off('close', closed);
        resolve(value);
      };
      const closed = () => finish({ action: 'cancel' });
      const timer = setTimeout(closed, 5000);
      this.pending.set(id, finish);
      response.once('close', closed);
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(
        'event: message\ndata: ' +
          JSON.stringify({
            jsonrpc: '2.0',
            id,
            method: 'elicitation/create',
            params: { mode: 'form', message: '补充旧版任务信息', requestedSchema: form },
          }) +
          '\n\n',
      );
    });
  }
}

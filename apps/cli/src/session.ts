import { CliMcpPrompts } from './mcp-prompts.ts';
import type { startHost } from '@praxis/client-host';
import { assert, deltaSchema, eventSchema, safeError, type Event } from '@praxis/contracts';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { CliInteraction } from './interaction.ts';
import type { CliOptions } from './options.ts';

/** Owns the terminal subscription and per-session run state; runCli owns the Host. */
export class CliSession {
  private terminal: ReturnType<typeof createInterface> | undefined;
  private active = false;
  private interrupted = false;
  private finished = false;
  private closed = false;
  private finishWaiters: Array<() => void> = [];
  private interaction: CliInteraction;
  private mcpPrompts: CliMcpPrompts;
  constructor(
    private host: Awaited<ReturnType<typeof startHost>>,
    private sessionId: string,
    private values: CliOptions,
  ) {
    this.mcpPrompts = new CliMcpPrompts(
      host,
      sessionId,
      (error) => this.report(error),
      () => this.terminal?.prompt(),
    );
    this.interaction = new CliInteraction(
      host,
      sessionId,
      () => this.terminal?.prompt(),
      Boolean(values.json),
    );
  }
  async run() {
    this.host.rpc.on('notification', this.onNotification);
    this.host.rpc.once('close', this.onHostClose);
    process.on('SIGINT', this.onInterrupt);
    process.once('SIGTERM', this.stop);
    const previous = await this.host.rpc.request<{ throughSeq: number }>('session/read', {
      sessionId: this.sessionId,
    });
    await this.host.rpc.request('session/subscribe', {
      sessionId: this.sessionId,
      afterSeq: previous.throughSeq,
    });
    if (this.values.prompt || this.values.command || this.values['apply-prompt']) {
      if (this.values['apply-prompt']) {
        assert(this.values['content-hash'], 'INVALID_ARGUMENT', '需要预览的 --content-hash。');
        await this.input(
          `/mcp-apply ${this.values['apply-prompt']} ${this.values['content-hash']}`,
        );
      } else if (this.values.command)
        await this.input(`/command ${this.values.command} ${this.values.arguments ?? '{}'}`);
      else await this.send(this.values.prompt!);
      if (!this.finished && !this.closed)
        await new Promise<void>((resolve) => this.finishWaiters.push(resolve));
      return;
    }
    assert(
      process.stdin.isTTY,
      'TTY_REQUIRED',
      '非交互运行请提供 --prompt、--command 或 --apply-prompt。',
    );
    console.log(`Praxis · ${this.sessionId}\n输入任务，/exit 退出。`);
    this.terminal = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '你 › ',
    });
    this.terminal.on('SIGINT', this.onInterrupt);
    this.terminal.prompt();
    for await (const raw of this.terminal) {
      const line = raw.trim();
      if (line === '/exit') break;
      try {
        await this.input(line);
      } catch (error) {
        this.report(error);
      }
      this.terminal.prompt();
    }
  }
  private async input(line: string) {
    if (!line) return;
    if (line === '/cancel') {
      await this.host.rpc.request('mcp/prompt-cancel', { sessionId: this.sessionId });
      await this.host.rpc.request('session/cancel', { sessionId: this.sessionId });
      return;
    }
    if (await this.interaction.respond(line)) return;
    if (line.startsWith('/mcp-apply ')) this.finished = false;
    const mcp = await this.mcpPrompts.input(line);
    if (mcp) {
      if (mcp === 'submitted' && !this.finished) this.active = true;
      return;
    }
    if (line === '/commands') {
      console.log(
        JSON.stringify(await this.host.rpc.request('plugin/commands', { kind: 'agent' }), null, 2),
      );
      return;
    }
    if (line.startsWith('/command ')) {
      const match = /^\/command ([^/\s]+)\/([^\s]+)(?:\s+([\s\S]+))?$/.exec(line);
      assert(match, 'INVALID_COMMAND', '格式：/command 插件ID/命令名 {"参数":"值"}');
      this.finished = false;
      await this.host.rpc.request('plugin/run-command', {
        sessionId: this.sessionId,
        requestId: randomUUID(),
        pluginId: match[1],
        name: match[2],
        arguments: JSON.parse(match[3] ?? '{}'),
      });
      if (!this.finished) this.active = true;
      return;
    }
    if (line.startsWith('/steer ')) await this.send(line.slice(7), 'steer');
    else await this.send(line.startsWith('/queue ') ? line.slice(7) : line);
  }
  private async send(text: string, mode: 'queue' | 'steer' = 'queue') {
    this.finished = false;
    const state =
      mode === 'steer'
        ? await this.host.rpc.request<{ turnId: string | null }>('session/read', {
            sessionId: this.sessionId,
          })
        : undefined;
    await this.host.rpc.request('session/prompt', {
      sessionId: this.sessionId,
      requestId: randomUUID(),
      text,
      mode,
      ...(state?.turnId ? { expectedTurnId: state.turnId } : {}),
    });
    if (!this.finished) this.active = true;
  }
  private onNotification = (method: string, raw: unknown) => {
    try {
      if (this.values.json) console.log(JSON.stringify({ method, params: raw }));
      if (method === 'session/delta' && !this.values.json)
        process.stdout.write(deltaSchema.parse(raw).text);
      if (method === 'session/event') {
        const event = eventSchema.parse(raw);
        if (event.sessionId === this.sessionId) this.event(event);
      }
    } catch (error) {
      this.report(error);
      this.stop();
    }
  };
  private event(event: Event) {
    if (event.type === 'turn/started') {
      this.active = true;
      this.finished = false;
      this.interrupted = false;
    }
    this.interaction.event(event);
    if (event.type === 'plugin/command-result' && !this.values.json)
      console.log(
        `\n[插件命令 ${String(event.payload.name)}]\n${String(event.payload.preview)}\n产物：${String(event.payload.artifactId)}`,
      );
    if (event.type === 'tool/result' && !this.values.json) {
      const result = event.payload.result;
      if (result && typeof result === 'object' && 'toolId' in result && 'status' in result)
        console.log(`\n[${String(result.toolId)}] ${String(result.status)}`);
    }
    if (event.type === 'turn/error' && !this.values.json)
      console.error(`\n${String(event.payload.code)}: ${String(event.payload.safeMessage)}`);
    if (event.type !== 'turn/finished') return;
    this.active = false;
    this.finished = true;
    this.interrupted = false;
    if (!this.values.json) console.log(`\n任务状态：${String(event.payload.status)}`);
    if (event.payload.status !== 'completed') process.exitCode = 1;
    this.releaseWaiters();
    this.terminal?.prompt();
  }
  private onInterrupt = () => {
    if (this.active && !this.interrupted) {
      this.interrupted = true;
      void this.host.rpc.request('session/cancel', { sessionId: this.sessionId }).catch((error) => {
        this.report(error);
        this.stop();
      });
    } else this.stop();
  };
  private onHostClose = () => {
    if (!this.finished && this.active) process.exitCode = 1;
    this.close();
  };
  private stop = () => {
    this.close();
    void this.host.close().catch((error) => this.report(error));
  };
  private report(error: unknown) {
    const safe = safeError(error);
    console.error(`${safe.code}: ${safe.safeMessage}`);
  }
  private releaseWaiters() {
    for (const resolve of this.finishWaiters.splice(0)) resolve();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.mcpPrompts.close();
    process.off('SIGINT', this.onInterrupt);
    process.off('SIGTERM', this.stop);
    this.host.rpc.off('notification', this.onNotification);
    this.host.rpc.off('close', this.onHostClose);
    this.terminal?.off('SIGINT', this.onInterrupt);
    this.terminal?.close();
    this.releaseWaiters();
  }
}

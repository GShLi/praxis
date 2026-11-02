import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { startHost } from '../../../packages/client-host/src/index.ts';
import { assert, safeError } from '../../../packages/contracts/src/index.ts';
import type { Event, Session } from '../../../packages/contracts/src/index.ts';

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      server: { type: 'string' },
      workspace: { type: 'string' },
      provider: { type: 'string' },
      resume: { type: 'string' },
      prompt: { type: 'string' },
      digest: { type: 'string' },
      json: { type: 'boolean' },
      'read-only': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const command = positionals[0] ?? 'help';
  if (values.help || command === 'help') {
    console.log(
      '知行 Praxis\n\npnpm cli doctor\npnpm cli run --workspace /path/to/project [--prompt "任务"] [--resume SESSION_ID]\npnpm cli sessions\npnpm cli providers\npnpm cli plugins [list|inspect PATH|install PATH --digest SHA256|enable ID|disable ID]\n\n配置 PRAXIS_SERVER_URL 和 PRAXIS_API_KEY；厂商 Key 在统一模型设置中填写。\n交互命令：/cancel、/steer 内容、/queue 内容、/exit。Ctrl-C 请求取消，再按一次退出。',
    );
    return;
  }
  assert(
    ['doctor', 'run', 'sessions', 'providers', 'plugins'].includes(command),
    'INVALID_COMMAND',
    '未知命令，使用 --help 查看帮助。',
  );
  const host = await startHost('cli');
  let terminal: ReturnType<typeof createInterface> | undefined;
  let interrupted = false;
  let sessionId = '';
  let active = false;
  const finishWaiters: Array<() => void> = [];
  let finished = false;
  let question:
    | {
        questionId: string;
        turnId: string;
        questions: Array<{
          id: string;
          prompt: string;
          options?: Array<{ id: string; label: string }>;
        }>;
        answers: Array<{ id: string; selectedOptionId?: string; text?: string; skipped: boolean }>;
      }
    | undefined;
  const printQuestion = () => {
    if (!question) return;
    const item = question.questions[question.answers.length]!;
    console.log(`\n${item.prompt}`);
    item.options?.forEach((option, index) => console.log(`  ${index + 1}. ${option.label}`));
    console.log('输入选项序号或文字；/skip 跳过。');
    terminal?.prompt();
  };
  const stop = async () => {
    terminal?.close();
    await host.close();
  };
  const onInterrupt = () => {
    if (active && !interrupted) {
      interrupted = true;
      void host.rpc.request('session/cancel', { sessionId }).catch(() => stop());
    } else void stop();
  };
  process.on('SIGINT', onInterrupt);
  process.once('SIGTERM', () => {
    void stop();
  });
  try {
    if (command === 'doctor') {
      console.log(JSON.stringify(await host.rpc.request('host/diagnostics'), null, 2));
      return;
    }
    const serverUrl = values.server ?? process.env.PRAXIS_SERVER_URL ?? 'http://127.0.0.1:4310';
    const praxisApiKey = process.env.PRAXIS_API_KEY;
    assert(
      praxisApiKey,
      'PRAXIS_KEY_REQUIRED',
      '请先设置 PRAXIS_API_KEY；不要将密钥写在命令行参数中。',
    );
    await host.rpc.request('auth/bind', {
      serverUrl,
      praxisApiKey,
      ...(values.provider ? { providerId: values.provider } : {}),
      interactive: Boolean(process.stdin.isTTY && !values.prompt),
    });
    if (command === 'plugins') {
      const action = positionals[1] ?? 'list',
        source = positionals[2];
      const state = await host.rpc.request<{ revision: number }>('plugin/list');
      let result: unknown;
      if (action === 'list') result = state;
      else if (action === 'inspect') {
        assert(source, 'INVALID_ARGUMENT', '需要插件目录。');
        result = await host.rpc.request('plugin/inspect', { source });
      } else if (action === 'install') {
        assert(
          source && values.digest,
          'INVALID_ARGUMENT',
          '请先 inspect 检查来源与能力，再用 --digest 指定确认的摘要安装可信插件。',
        );
        result = await host.rpc.request('plugin/install', {
          source,
          expectedDigest: values.digest,
          expectedRevision: state.revision,
        });
      } else if (action === 'enable' || action === 'disable') {
        assert(source, 'INVALID_ARGUMENT', '需要插件 ID。');
        result = await host.rpc.request('plugin/set-enabled', {
          id: source,
          enabled: action === 'enable',
          expectedRevision: state.revision,
        });
      } else throw new Error('plugins 支持 list / inspect / install / enable / disable。');
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (command === 'sessions' || command === 'providers') {
      console.log(
        JSON.stringify(
          await host.rpc.request(command === 'sessions' ? 'session/list' : 'provider/list'),
          null,
          2,
        ),
      );
      return;
    }
    if (values.resume) {
      const result = await host.rpc.request<{ session: Session }>('session/read', {
        sessionId: values.resume,
      });
      assert(result.session.kind === 'agent', 'MODE_UNAVAILABLE', 'CLI 只支持 Agent 会话。');
      sessionId = result.session.id;
    } else {
      const workspace = await host.rpc.request<{ id: string }>('workspace/open', {
        path: values.workspace ?? process.cwd(),
      });
      const session = await host.rpc.request<Session>('session/create', {
        kind: 'agent',
        workspaceId: workspace.id,
      });
      sessionId = session.id;
    }
    if (values['read-only']) {
      const state = await host.rpc.request<{ session: Session }>('session/read', { sessionId });
      await host.rpc.request('session/set-permissions', {
        sessionId,
        expectedRevision: state.session.permission.revision,
        permission: { ...state.session.permission, mode: 'read-only' },
      });
    }
    const previous = await host.rpc.request<{ throughSeq: number }>('session/read', { sessionId });
    host.rpc.on('notification', (method: string, raw: unknown) => {
      if (values.json) {
        console.log(JSON.stringify({ method, params: raw }));
      }
      if (method === 'session/delta' && !values.json) {
        const delta = raw as { text: string };
        process.stdout.write(delta.text);
      }
      if (method !== 'session/event') return;
      const event = raw as Event;
      if (event.sessionId !== sessionId) return;
      if (event.type === 'turn/started') {
        active = true;
        finished = false;
        interrupted = false;
      }
      if (event.type === 'tool/result' && !values.json) {
        const result = event.payload.result as {
          toolId: string;
          status: string;
          error?: { message: string };
        };
        console.log(
          `\n[${result.toolId}] ${result.status}${result.error ? ': ' + result.error.message : ''}`,
        );
      }
      if (event.type === 'question/asked') {
        question = {
          ...(event.payload as Omit<NonNullable<typeof question>, 'answers'>),
          answers: [],
        };
        printQuestion();
      }
      if (event.type === 'turn/error' && !values.json)
        console.error(`\n${String(event.payload.code)}: ${String(event.payload.safeMessage)}`);
      if (event.type === 'turn/finished') {
        active = false;
        finished = true;
        interrupted = false;
        question = undefined;
        if (!values.json) console.log(`\n任务状态：${String(event.payload.status)}`);
        if (event.payload.status !== 'completed') process.exitCode = 1;
        for (const resolve of finishWaiters.splice(0)) resolve();
        terminal?.prompt();
      }
    });
    await host.rpc.request('session/subscribe', { sessionId, afterSeq: previous.throughSeq });
    const send = async (text: string, mode: 'queue' | 'steer' = 'queue') => {
      finished = false;
      const state =
        mode === 'steer'
          ? await host.rpc.request<{ turnId: string | null }>('session/read', { sessionId })
          : undefined;
      await host.rpc.request('session/prompt', {
        sessionId,
        requestId: randomUUID(),
        text,
        mode,
        ...(state?.turnId ? { expectedTurnId: state.turnId } : {}),
      });
      active = true;
    };
    if (values.prompt) {
      await send(values.prompt);
      if (!finished) await new Promise<void>((resolve) => finishWaiters.push(resolve));
      return;
    }
    assert(process.stdin.isTTY, 'TTY_REQUIRED', '非交互运行请提供 --prompt。');
    console.log(`Praxis · ${sessionId}\n输入任务，/exit 退出。`);
    terminal = createInterface({ input: process.stdin, output: process.stdout, prompt: '你 › ' });
    terminal.on('SIGINT', onInterrupt);
    terminal.prompt();
    for await (const raw of terminal) {
      const line = raw.trim();
      if (!line) {
        terminal.prompt();
        continue;
      }
      try {
        if (line === '/exit') break;
        if (line === '/cancel') {
          await host.rpc.request('session/cancel', { sessionId });
          continue;
        }
        if (question) {
          const item = question.questions[question.answers.length]!;
          const choice = /^\d+$/.test(line) ? item.options?.[Number(line) - 1] : undefined;
          question.answers.push({
            id: item.id,
            ...(choice ? { selectedOptionId: choice.id } : line === '/skip' ? {} : { text: line }),
            skipped: line === '/skip',
          });
          if (question.answers.length === question.questions.length) {
            await host.rpc.request('question/respond', {
              sessionId,
              questionId: question.questionId,
              turnId: question.turnId,
              answers: question.answers,
            });
            question = undefined;
          } else printQuestion();
          continue;
        }
        if (line.startsWith('/steer ')) await send(line.slice(7), 'steer');
        else await send(line.startsWith('/queue ') ? line.slice(7) : line);
      } catch (error) {
        const safe = safeError(error);
        console.error(`${safe.code}: ${safe.safeMessage}`);
      }
      terminal.prompt();
    }
  } finally {
    process.off('SIGINT', onInterrupt);
    terminal?.close();
    await host.close();
  }
}
main().catch((error: unknown) => {
  const e = safeError(error);
  console.error(`${e.code}: ${e.safeMessage}`);
  process.exitCode = 1;
});

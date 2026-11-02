import { startHost } from '../../../packages/client-host/src/index.ts';
import { safeError } from '../../../packages/contracts/src/index.ts';

async function main() {
  const command = process.argv[2] ?? '--help';
  if (command === '--help' || command === 'help') {
    console.log(
      '知行 Praxis\n\n用法: pnpm cli doctor\n\ndoctor  检查私有 Host 启动、协议与运行环境\n\n当前工程阶段：会话和 Agent 功能尚在开发。',
    );
    return;
  }
  if (command !== 'doctor') {
    process.exitCode = 2;
    console.error('未知命令。运行 pnpm cli --help 查看帮助。');
    return;
  }
  const host = await startHost('cli');
  try {
    console.log(JSON.stringify(await host.rpc.request('host/diagnostics'), null, 2));
  } finally {
    await host.close();
  }
}
main().catch((error: unknown) => {
  const e = safeError(error);
  console.error(`${e.code}: ${e.safeMessage}`);
  process.exitCode = 1;
});

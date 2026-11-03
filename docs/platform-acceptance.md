# macOS / Linux 实机验收

此记录区分真实系统、桌面交互、真实模型和发行验收；不能相互替代。当前生产命令沙箱和 MCP stdio 尚未开放。

## 2026-11-04：桌面操作与真实模型

- macOS：通过 CUA 实际操作编译后的 Electron 应用，使用独立 PostgreSQL、临时桌面 profile、一次性账号和明确标注的测试 Provider。
- 已验证：API Key 登录；Chat 回复；模型配置列表读取；用户指令保存；Agent 工作区选择；同一会话创建 HTML、读取版本并打补丁；工具记录和修改前后内容；停止按钮取消任务；活动任务期间退出；重新登录后历史与用户指令保留、任务不自动重跑；插件列表和 MCP 空态。
- 文件实际内容为 `<h1>你好 Praxis！！！</h1>`。退出后通过新 Host 重新取得 profile 锁并读取状态，Agent 为 `cancelled`，Chat 为 `completed`。Electron 两次退出均返回 0。
- 这轮没有验证完整 MCP/OAuth 桌面操作、真实模型在桌面上的交互、安装包、签名、公证或升级。Linux SSH 环境未提供图形显示服务，尚未实际运行桌面界面。
- 经用户明确选择，macOS 与 Ubuntu 分别使用 Praxis 已配置的默认模型 `deepseek-flash`，各发起 6 次真实请求，完成 Chat 连通、创建 HTML、同一任务读取后修改三个场景。使用真实 AuthClient、DeepSeekClient、AgentRuntime、SQLite 和原生文件工具；未执行命令，没有将测试记入用户原有本地会话。
- 每个平台限制最多 7 次实际发送（包括重试）、每次输出 1024 tokens、每轮 60 秒。Linux 通过临时 SSH loopback 反向转发访问认证服务，登录信息仅从私有 stdin 输入，厂商 Key 由客户端领取并直连厂商；未保存或上传本地凭据文件。隧道随测试退出关闭。
- 测试环境清理曾发现先停止临时 PostgreSQL 会使数据库删除失败，已调整为运行时/测试库先关闭、集群随后关闭，并用独立启动→SIGTERM→exit 0→临时目录不存在验证。首个失败清理遗留的两个专用目录已确认 PostgreSQL 退出后移除。

## 2026-11-04：系统凭据和 Seatbelt 边界

- Ubuntu 22.04.5：独立 D-Bus 和 GNOME Keyring 的锁定回归先失败后通过。`secret-tool lookup` 在已有项目锁定时也会 quiet exit 1；现在二次 `search --all`（不请求解锁）仅在成功且无输出时判定缺失。其余情况返回系统存储不可用，不记录 helper 输出、不丢弃凭据引用。验证锁定读取/轮换失败、重新解锁后旧值完整；连同精确字节、服务重启、8 KiB 边界和断开服务，共 5 项通过。
- macOS 27.2 arm64：4 项原生 Seatbelt 测试通过，覆盖工作区读取、外部文件/符号链接拒绝、只读与可写区分、私有临时目录写入、fork/exec 继承、TCP loopback 和 pathname Unix socket 拒绝。socket 先在沙箱外验证可连接，避免将坏 fixture 当成隔离成功。
- 最小策略启动曾在 dyld/libignition 中 SIGABRT；依据本机 `/System/Library/Sandbox/Profiles/dyld-support.sb`，允许读取根目录本身作为 openat 起点后通过，未开放根目录下文件的递归读取。该策略仅用于固定测试程序，不是生产命令策略，也不证明保护路径硬链接、Mach IPC 或脱离进程组后的回收。
- 凭据修复后两端各 220 项核心回归、结构/类型检查和全部应用构建通过，无跳过；Web 构建仍有已有的大 chunk 提示。Linux 用户真实 SSH 会话没有配置 Secret Service，本次持久化/锁定测试仅在可回收的私有 daemon 上完成。

```sh
pnpm test:macos-isolation
PRAXIS_TEST_KEYRING_HELPER=/path/to/gnome-keyring-daemon pnpm test:linux-keyring
pnpm test:linux-credentials
```

## 可重复入口

先运行 `pnpm build`。真实模型测试不在默认自动回归里，不会因为运行 `pnpm check` 而计费。

```sh
# 仅使用给定私有配置中的 serverUrl 和 praxisApiKey，不输出它们。
node --import tsx tests/manual/live-model.ts .runtime/local-dev/login.local.json

# 隔离桌面 fixture：需指定测试 PostgreSQL，运行后打印临时入口和一次性测试登录信息。
PRAXIS_TEST_PG_BIN=/path/to/postgresql/bin \
  node --import tsx tests/manual/desktop-fixture.ts
```

启动 Electron 时使用 fixture 打印的 `entry`。先关闭 Electron，再向 fixture 发 SIGTERM；fixture 会回收测试账号所在数据库和整个临时目录。它最多运行一小时，不使用用户原有桌面 profile。便携 PostgreSQL 可另设 `PRAXIS_TEST_PG_SHARE`。

`live-model.ts -` 可从 stdin 接受相同格式的 JSON，以便通过受控 SSH 私有管道测试；不把 Key 放进 argv 或提交到仓库。此入口只验证 Chat 与文件任务，不代表压缩、命令、MCP、所有故障路径和长时间运行均已完成真实厂商验收。

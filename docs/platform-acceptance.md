# macOS / Linux 实机验收

此记录区分真实系统、桌面交互、真实模型和发行验收；不能相互替代。当前生产命令沙箱和 MCP stdio 尚未开放。

## 2026-11-04：命令管理与持久化

- macOS Node 22.15 与 Ubuntu Node 24.22 各 239 项核心测试通过，无跳过；结构、类型、原生 helper 和全部应用构建通过。新增 15 项命令输出、生命周期、真实审批门与 SQLite 重开测试，详见 [实现记录](command-execution.md)。
- 这批后端为可控生命周期夹具，未宣称生产隔离已通过。此前 4 项 macOS / 5 项 Linux 原生机制测试的范围保持不变；生产命令、stdio、Linux 图形界面及签名/安装/升级验收仍待完成。

## 2026-11-04：Linux 过滤视图与崩溃清理

- 新增 5 项真实 FUSE/namespace 测试全部通过；C helper 以 Wall/Wextra/Werror 编译，两端结构/类型检查通过。测试专用 libfuse3 开发包解压在用户验证目录，系统运行库未替换，无 sudo 操作。
- 验证普通文件可读、保护名称与大小写变体隐藏、多硬链接和符号链接拒绝、只读不修改源文件、私有目录改名与替换导致视图拒绝访问、已打开文件复核、工作区目录句柄固定和错误身份拒绝。
- 初次强杀实测发现系统 fusermount3 3.10.5 的自动卸载不可靠。最终崩溃方案把视图与受信任监督流程放入独立 user/pid/mount namespace；分别强杀模拟 Host 与视图进程，等待管道 EOF，确认 PID namespace 无成员、宿主没有新增测试挂载。故障调查的临时挂载已显式清理。
- 此 helper 是只读原型，未装配到生产 Host；固定测试 Worker 的宿主只读视图与 namespace 内 CAP_SYS_ADMIN 只供构建/挂载测试使用，不是用户命令的运行权限。生产命令需要另一个受限执行视图、去能力及网络/系统调用/资源策略。详见 [原型边界](../native/workspace-view/README.md)。

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

## 2026-11-04：SQLite 容量耗尽与恢复

- 临时文件数据库通过 `PRAGMA max_page_count` 触发真实 `SQLITE_FULL`，不填满宿主磁盘。回归先复现二次 ROLLBACK 把 errcode 13 覆盖为“没有活动事务”的 errcode 1。
- 事务所有者现在只忽略 SQLite 已自行回滚这一明确结果，保留原始容量故障；其他回滚异常仍抛出，并保留原故障。该处理遵循 [SQLite 事务错误语义](https://sqlite.org/lang_transaction.html#response_to_errors_within_a_transaction)，兼容本机 Node 22.15 没有 `isTransaction` 的情况。
- 验证失败事务的前序写入一起回滚、不发事件、序号不前进；提高容量后可继续提交，重新打开后记录完整且 integrity_check 为 ok。Agent 在工具派发前写库失败时停止，不创建目标文件、不重试模型，恢复不会自动执行该写入。
- 修复后 macOS（Node 22.15.0）和 Linux（Node 24.22.2）各 222 项核心、30 项 PostgreSQL/HTTP/CLI 集成、结构/类型检查和应用构建全部通过，无跳过。这是 SQLite 容量错误路径验收，不代替文件系统 ENOSPC、断电和长期压力验收。

## 2026-11-04：桌面 MCP 与 IPC 错误

- 实际操作 Electron 新建临时 MCP 连接，验证保存后需检查再启用、2026-07-28 协商、1 个兼容工具、停用、编辑端点后重新检查，以及退出后配置保留。服务均为本机临时 fixture，不使用用户真实 MCP 配置或凭据。
- 提示词目录→参数预览→确认入队→模型回复通过；第二个 fixture 返回 input_required，界面正确让出补充表单，填写后展示完整续交参数和目标，批准一次后回到预览并提交。退出后数据库核对到 2 次 prompt-applied、1 次 question/answered 和 1 次 approval/consumed；会话 completed。
- 连接中断复现界面显示 Electron 内部 `Error invoking remote method` 前缀。主进程现在返回仅含 safeError 的结构化结果，preload 验证并还原业务错误，传输故障使用固定安全文案；窗口/方法校验保持原位置和效力。针对性回归覆盖已知业务错误、未知私有错误脱敏、空成功值和非法响应。
- 重新构建并实际重开后，同一失败操作只显示“MCP 协议请求失败；未自动重放业务请求。”。重新登录、配置/历史读取、目录对话框取消和真实文件创建均通过；文件内容 `<h1>Hello World！！！</h1>` 已核对。两次 Electron 退出均返回 0，fixture 关闭后临时目录不存在。
- 两端各 224 项核心回归、结构/类型和应用构建通过，无跳过；PostgreSQL/HTTP/CLI 的 30 项结果沿用上一存储修复批次，没有为此桌面桥接变更重复运行。完整 OAuth 浏览器授权和桌面 MCP 工具/资源业务调用仍未经过本轮界面验收。

## 当前验收汇总与剩余项

| 项目 | macOS | Ubuntu 22.04.5 |
| --- | --- | --- |
| 核心自动回归 | 224/224 | 224/224 |
| 真实 PostgreSQL/HTTP/CLI 集成 | 30/30 | 30/30 |
| 系统隔离机制原型 | Seatbelt 4/4 | Bubblewrap 5/5 |
| 系统凭据 | 核心套件含真实 Keychain 读写/删除 | 私有 Keyring/服务故障 5/5 |
| 已配置 DeepSeek | 6 请求完成 Chat、创建与修改 | 6 请求完成相同场景 |
| Electron 实际界面 | 主要流程及 MCP 配置/模板/表单通过，范围见上文 | 未提供图形显示服务，未运行 |
| 结构、类型及应用构建 | 通过 | 通过 |

仍未完成的验收：生产命令沙箱及 MCP stdio（执行后端尚未接通，含 macOS 脱离进程组后的子孙回收）、桌面 MCP 工具/资源业务调用和 OAuth、外部服务互操作、Linux 桌面实际交互、安装包/签名/升级、真实模型长任务压缩、长期压力及真实文件系统写满。只有当前机器的 OS/架构得到上述证据，不扩展为其他版本或架构已支持。

## 可重复入口

先运行 `pnpm build`。真实模型测试不在默认自动回归里，不会因为运行 `pnpm check` 而计费。

```sh
# 仅使用给定私有配置中的 serverUrl 和 praxisApiKey，不输出它们。
node --import tsx tests/manual/live-model.ts .runtime/local-dev/login.local.json

# 隔离桌面 fixture：需指定测试 PostgreSQL，运行后打印临时入口和一次性测试登录信息。
PRAXIS_TEST_PG_BIN=/path/to/postgresql/bin \
  node --import tsx tests/manual/desktop-fixture.ts

# 可选：独立本机 MCP 测试服务；--form 使模板请求补充表单。
node --import tsx tests/manual/mcp-fixture.ts --form
```

启动 Electron 时使用 fixture 打印的 `entry`。先关闭 Electron，再向 fixture 发 SIGTERM；fixture 会回收测试账号所在数据库和整个临时目录。它最多运行一小时，不使用用户原有桌面 profile。便携 PostgreSQL 可另设 `PRAXIS_TEST_PG_SHARE`。

`live-model.ts -` 可从 stdin 接受相同格式的 JSON，以便通过受控 SSH 私有管道测试；不把 Key 放进 argv 或提交到仓库。此入口只验证 Chat 与文件任务，不代表压缩、命令、MCP、所有故障路径和长时间运行均已完成真实厂商验收。

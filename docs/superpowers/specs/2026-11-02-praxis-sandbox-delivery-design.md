# Praxis 系统沙箱、运行保障与工程交付设计

日期：2026-11-02。状态：详细提案；三平台真实 OS 沙箱是已确认要求，本文候选后端尚未实现或验证。关联[内置工具](2026-11-02-praxis-tools-design.md)、[协议与生命周期](2026-11-02-praxis-protocol-chat-design.md)、[参考分析](2026-11-02-praxis-reference-analysis.md)。

## 1. 统一策略与执行合同

```ts
interface ExecutionPolicy {
  revision: number;
  fileMode: "read-only" | "workspace-write" | "danger-full-access";
  readRoots: string[];
  writeRoots: string[];
  protectedPaths: string[];
  network: "deny" | "allow";
  tempRoot: string;
  deadline: number;
  processLimit: number;
  grantIds: string[]; // Host 生成，模型不能填
}
```

权限预设只是解析策略的起点。实际执行需验证规范化路径与资源身份、操作范围、审批绑定、平台能力及生命周期控制。能力报告分别列 fileRead、fileWrite、protectedPaths、network、processIsolation、descendantCleanup，不用一个 full/partial 值掩盖差异。

第一版建议默认 workspace-write + ask，命令网络默认 deny；审批允许本次命令及其受管理子进程联网，文件范围保持原限制。allow 表示一般网络访问，不宣称按域名限制或无远程副作用；受保护的 Host 控制通道、凭据服务和危险本机 IPC 仍不可访问。按域名白名单需要代理、DNS 和直连阻断的完整方案，第一版不提供。

只读预设允许每次执行的专用临时目录写入，用于运行库与临时文件，禁止项目和其他持久目录写入；临时目录与其他会话隔离并在清理后回收。审批的外部写目录必须明确且参与占用协调。完全访问仅保留为显式高级提案，默认不开放入口，也不能由失败自动触发；若启用，必须标明放弃了哪些隔离保证，仍受身份、进程清理和预算约束。

文件策略不是防泄漏产品：允许命令读取某文件并联网时，该命令可能发送文件内容；只读也不阻止远程写操作。Host 模型/认证联网与命令联网分开，不能为了 Host 调用模型而给所有子进程放开网络。

## 2. 三个平台的候选实现

| 平台 | 第一版建议路线 | 必须先验证的边界 |
| --- | --- | --- |
| macOS | Seatbelt 策略启动器，按执行编译读写/网络/进程访问规则；原生辅助程序负责启动与存活管理 | 支持的系统版本下规则确实生效；子进程继承、系统依赖、禁止凭据与 Host 进程访问、服务启动逃逸及退出清理 |
| Linux | Bubblewrap 建立最小挂载视图及 namespace，配套最小 /proc、网络隔离和适当系统调用限制 | user namespace 可用性、目录遮蔽、链接/挂载、Unix socket 与网络、禁止 ptrace/控制宿主、命名空间内进程清理 |
| Windows | AppContainer 能力与资源 ACL，配合受控启动器和 Job Object 生命周期控制 | Node/编译器/Shell 兼容、系统库读取、文件别名/重解析点、网络能力、宿主进程访问、ACL 最小授予及回收 |

Windows 不直接把 DSH 的 Restricted Token + ACL 后端当作完整方案。AppContainer 的隔离机制由 [Microsoft 文档](https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation)说明，但能否无破坏地运行 Praxis 的目标工具链仍需原型验证。必要时调整原生后端，不能悄悄降低产品所声明的边界。

[Bubblewrap](https://github.com/containers/bubblewrap) 提供构建隔离环境的机制，安全性取决于实际参数和暴露资源；仅安装可执行文件不代表策略正确。第一版 Linux 不提供未经同等测试的 Landlock 自动后备。Windows [Job Object](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) 管理进程组及终止，不替代文件和网络隔离。

TypeScript 实现业务、策略和协议；系统启动器、OS 锁和安全句柄允许使用小型原生辅助程序。原生层不承担 Agent 决策、Provider 或 Session 业务。辅助程序的最小权限、输入 Schema 和二进制来源需随发行验证。

系统版本与架构的初始验证提案为 macOS 14+ arm64/x64、Windows 11 x64、Ubuntu 24.04 x64；这是测试起点，不是已经支持这些系统，也不声称覆盖所有 Linux 发行版。实际支持矩阵在首个原型结果后锁定，并核对当时 Node/Electron 与系统生命周期。三类 OS 不因其中一个实现困难而静默从首发要求移除。

## 3. 启动与授权落地

执行器顺序：probe → normalize policy → prepare isolated resources → verify enforcement → persist intent → spawn suspended/受控启动 → 建立管理关系 → 放行用户程序 → 收集输出与终态 → cleanup → 保存收据。

准备操作不得运行项目脚本。若平台不能在用户代码开始前完成隔离与进程归属绑定，该后端不能通过验收。argv 使用参数数组和独立策略载荷，不经字符串 Shell 拼接；Shell 仅来自用户工具请求中明确的脚本模式。

启动器只接受 Host 提供的策略、可执行路径与参数，不接受工具正文声称的 approved 字段。审批绑定的规范参数 hash、cwd、资源身份、策略版本、callId 和有效期必须在 spawn 前重新验证。准备失败释放资源并返回 `SANDBOX_UNAVAILABLE` 或 `POLICY_UNSUPPORTED`，不启动普通宿主命令。

MCP stdio 也必须经过该启动器，不能让 SDK 自带 spawn 或探测临时进程绕过它。用途为 mcp-server 的进程开放专用协议 stdin/stdout，普通命令仍关闭 stdin；MCP 占用执行位直到子孙回收。它可按显式配置取得自己的服务凭据，但绝不继承 Praxis/模型/其他 Server 秘密，详见[MCP 本地隔离](2026-11-02-praxis-mcp-security-design.md#2-本地-stdio-的沙箱与并发)。

Host 创建受限 env 白名单、独立 HOME/TMP 和必要 PATH，剔除 Praxis、厂商、云平台凭据及不需要的注入变量；不继承 SSH agent、Docker socket、宿主控制句柄。允许的工具链目录和缓存显式加入策略，不能以运行 npm 为理由直接开放整个用户主目录。

工作区里的敏感文件按保护策略遮蔽/拒绝，批准特定文件后才改变当次可见性。无法表达“允许目录但拒绝其中受保护文件”的后端不能宣称满足该策略；应采用隔离视图或拒绝调用。保护还包括 Praxis 数据目录、Keychain/凭据存储和 Host 调试接口，不能仅靠清理环境变量。

## 4. 文件操作与竞态

内置文件服务使用规范化路径、目录句柄相对访问与可用的防链接选项，校验授权目标身份；实际平台能力由 native/fs adapter 报告。高层 exists → read → write 不能作为完整防路径竞态方案。

替换文件采用受控临时文件和原子发布；版本观察只能检测已知基线变化，不能保证任意外部编辑器参与事务。文件工具、Shell 和搜索都必须遵守同一受保护范围；搜索 subprocess 同样经过隔离。

审批不能绕过对 `.praxis` 安装/凭据和其他 Session 私有数据的 Host 硬拒绝。用户选择父目录作为 Workspace 时，保护目录优先；同目录被另一个授权路径别名访问仍需拒绝。硬链接、symlink、junction、大小写、Windows ADS/设备路径等按平台支持策略拒绝或安全解析，不能只做字符串前缀判断。

## 5. 进程与退出保障

Execution ID 对应启动收据、Host 实例、隔离域与受控进程句柄，不向模型暴露可操作的任意 PID。Job Object/进程 namespace/原生监督器按平台实现，禁止允许任务逃离当前执行域的 breakaway、后台服务注册和其他可用逃逸通道。

正常取消先发送适当终止信号，宽限内收集已完成结果，随后强制清理执行域。父进程与 Host 双向检测；Host 崩溃时原生执行域仍应停止命令，父进程整体死亡也须有内核关闭语义或受控监督器执行清理。监督器仅为当前应用存活，不是长任务守护服务。

仅 kill 一个 PID 或一个可被 setsid 逃出的普通进程组不足以证明任意子孙均已清理。平台原型需测试 fork、双重 fork、独立 session、Shell 后台、子进程再次派生和系统服务代理；不能落实的启动路径必须由沙箱禁止。OS/硬件整体故障时不保证有最终日志，重启按 interrupted/unknown 核对，不通过 PID 扫描随意杀无关进程。

turn 结束停止其剩余命令；应用退出停止全部 turn；只切换 Session 不停止其他 Session。命令已修改的文件保持实际结果，不承诺退出回滚。清理失败返回具体残留/未知状态和诊断，不能发成功清理通知。

MCP 提议采用每操作一个本地服务实例以避免闲置可写进程竞争；外部 HTTP MCP 只控制客户端请求，不能证明远端计算停止。第一版不协商 MCP Tasks，这不等于所有普通远程 API 都有可撤回效果。

## 6. 数据保留、诊断与错误

Session 原事件、所有已提交上下文版本、请求快照和有引用的产物不因压缩或日志轮换删除。工具产物按[工具限额](2026-11-02-praxis-tools-design.md)保存，超限产生明确截断标记，历史记录不能假装保留了未捕获字节。未引用临时对象可在 24 小时宽限后回收，仍活动或被 checkpoint 引用的对象不可删除。

诊断日志与 Session 分开：默认仅 request/session/turn/attempt/execution IDs、耗时、错误码、后端/策略版本、队列及用量，不默认记录提示词、文件内容、Key 或工具全文。日志提议单文件 50 MiB、最多 5 个、最长 14 天；诊断包由用户显式导出，列出包含范围并脱敏。

错误分类包括输入/状态、认证/配置、模型连接/协议、上下文、权限/沙箱、工具、存储、插件、生命周期。每类给稳定 code、是否可重试及下一步；不能把所有 DeepSeek 故障归为“摘要失败”，需保留如 DNS、代理、连接超时、401、429 的安全诊断链。

磁盘预检和产物限额用于尽早拒绝新任务；磁盘写满时停止新副作用，尝试提交终态并返回存储错误。即使无法再写数据库也不能继续执行；保留脱敏 stderr 诊断，下次恢复识别未闭合调用。数据库备份使用 SQLite/PG 一致备份机制，不复制仍在写入中的单个 db 文件冒充完整备份。

第一版无默认上传遥测和云端本地 Session 日志。服务端只有认证、配置、凭据使用审计和 Web Chat 记录；本地直连的精确模型使用量不是可信的服务器计费依据。

## 7. 工程依赖与部署

总体技术提案为 Node.js + TypeScript strict + pnpm workspace，React/Vite、Electron、Hono 分别承担客户端/服务端入口；不用 Agent 框架。具体版本和锁文件在实现阶段核对。逻辑依赖方向：

```text
apps → composition / client adapters
agent-runtime → contracts + context + model interfaces + tool/store interfaces
chat-runtime  → contracts + context + model interfaces + store interfaces
tools → permissions + scoped file/process/artifact interfaces
infrastructure → interfaces + SQLite/PostgreSQL/native helpers
plugins → public plugin-sdk
```

contracts 不依赖 Electron、数据库或 Runtime；AgentRuntime 不 import HTTP handler；storage adapter 不直接唤醒模型；所有依赖从应用入口注入。共用基础类型与纯 reducer，不要求 Web、桌面和 CLI 强行共用运行入口。

服务端第一版为单实例模块化应用 + PostgreSQL + 受保护对象目录/卷，前置 TLS，单独迁移命令和管理员初始化命令；readiness 检查 DB、配置解密能力和必需 Provider 加载，liveness 不调用付费模型。关服停止接纳并取消 Chat，无常驻 Agent worker。扩容前增加持久执行租约，不直接多开共享进程内状态的实例。

## 8. 测试与发布门槛

| 层次 | 必须验证的内容 |
| --- | --- |
| 纯领域 | 状态转换、去重、输入竞态、预算、上下文配对及版本、策略求交 |
| 协议与故障注入 | Fake Provider 流式/重试/取消、迟到响应、背压、提交失败和事件恢复 |
| 本地集成 | 临时文件补丁、版本冲突、产物权限、SQLite 迁移、工作区锁及进程输出 |
| 每个 OS 真实测试 | 允许/拒绝读取与写入、链接竞态、网络、进程/凭据边界、父死亡及子孙清理 |
| 服务端 | 账号隔离、Key 范围、凭据加密与轮换、CSRF/SSRF、Chat 并发和重启 |
| 少量端到端 | DeepSeek 真实模型创建/修改 HTML、运行验证、多轮、压缩、退出后手动继续 |

真实沙箱测试使用专用临时工作区、外部哨兵文件、假秘密及测试监听端口。分别验证应成功和应失败的操作、作用于子进程的策略及不会触及实际用户敏感数据。单元测试 mock sandbox 不能代替这些验收。

建议先验证三平台隔离与退出原型，再实现核心存储和循环，随后接入模型/认证、MCP fixture，最后组装三端与插件发布；这是验证顺序，不是已经开始实施。每个阶段沿用总体 V01–V32、工具 T01–T15 及 MCP M01–M20；尚未通过的 OS 不标为已支持。

桌面和 CLI 都包含受校验的 Host 与原生辅助程序，按平台签名/校验、锁定依赖并生成物料清单。升级只在所有活动 turn 停止后替换，迁移前备份；降级不能直接写新版数据库，需兼容读或恢复升级前备份。安装及更新不自动启用新插件权限，不强制中断用户任务换版本。

## 9. 当前仍需验证的工程事实

设计已定义失败行为，但没有证明候选后端可用。实施前要验证 Windows AppContainer 的开发工具兼容与 ACL 回收、macOS 策略与逃逸阻断、Linux 目标环境的 namespace 可用性，以及三者的父死亡清理。若某后端失败，应更换能满足合同的原生实现并记录取舍，不向应用层路径过滤退化。

最低 OS/CPU、原生依赖打包、Node/Electron 精确版本和性能阈值在原型后锁定。这些属于有明确验收标准的实现验证项；不影响当前已经确定的三端能力、统一模型配置、本地直连和退出停止任务规则。

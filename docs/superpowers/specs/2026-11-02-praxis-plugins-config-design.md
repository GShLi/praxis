# Praxis 插件、工作区与配置治理设计

日期：2026-11-02。状态：详细提案。关联[总体设计](2026-11-02-praxis-design.md)、[工具设计](2026-11-02-praxis-tools-design.md)和[上下文设计](2026-11-02-praxis-context-design.md)。

## 1. 插件的第一版边界

插件扩展 Provider、Agent 工具、用户主动调用的命令以及有限生命周期钩子。第一版支持随应用交付的内置插件和用户显式安装的可信本地插件，不做插件市场、自动远程下载、UI 插件或不可信同进程代码隔离。接入外部 MCP Server 已有[独立详细设计](2026-11-02-praxis-mcp-design.md)；第一版不把 Praxis 本身做成对外 MCP Server。

可信 Host 插件运行在 Host 代码权限内。SDK 是稳定契约和审计通道，不是对恶意 JavaScript 的安全沙箱。模型生成的脚本只能通过 process.exec 进入 OS 沙箱，不能转换成 Host 插件来获得宿主权限。项目依赖、AGENTS.md、工具输出都不能触发插件安装。

服务端只装载部署者配置的 Provider/纯 Chat 扩展；用户上传的插件不能在 Web Chat 服务器激活。桌面 Host 可有 Chat 与 Agent 两类注册表，Chat 注册表禁止操作型工具。

## 2. 插件包与 Manifest

```json
{
  "id": "example.provider-demo",
  "version": "1.0.0",
  "sdkVersion": "^1.0.0",
  "entry": "dist/index.js",
  "runtimes": ["local-host"],
  "modes": ["chat", "agent"],
  "capabilities": ["model-provider"],
  "platforms": ["darwin", "win32", "linux"]
}
```

Manifest 限定 id、版本、SDK 范围、相对入口、支持系统/模式及能力。入口必须位于安装包内，拒绝路径逃逸和指向包外的符号链接；ID 与模型工具名冲突时拒绝激活。能力声明只申请接口，不是用户授权或执行许可。

安装流程：用户选择包 → 校验清单和包内容 → 显示来源、版本、声明能力及摘要 → 显式启用 → 原子发布到受保护版本目录 → 更新插件锁定记录。版本目录不可由模型工具修改，活动版本不原地覆盖。

第一版接收已构建的 JS 插件包，不自动执行 npm install、postinstall、编译脚本或包内二进制。依赖由插件作者构建进产物并附清单；内置依赖随发布锁定。哈希验证只证明文件与安装记录一致，不等于来源可信或安全审计。

## 3. SDK 服务与能力约束

| 能力 | SDK 接口方向 | 约束 |
| --- | --- | --- |
| model-provider | registerProvider、指定配置的 SecretResolver | 仅在该 Provider 运行时解析对应凭据，不接触任意其他用户配置 |
| agent-tool | registerTool、files/process/artifact 服务 | 必须声明 Schema、效果和资源需求；执行走 Host 策略 |
| user-command | registerCommand | 由用户主动调用，参数校验；不能绕过工具和权限流程 |
| policy-check | beforeExecute | 只可进一步 deny 或要求审批，不能清除 Host 拒绝 |
| context-contributor | contributeContext | 来源标签、大小上限和版本；不能改写原始用户输入或签发权限 |
| lifecycle | activate、onTurnFinished、dispose | 不直接推进循环或写 Session 数据库 |

宿主注入带用户和 Session 作用域的服务对象，不让插件从模型参数中自行声明用户身份。插件存储键按 pluginId+owner+scope 隔离，存储受限 JSON，不允许直接访问 Runtime 表。协议中保留 pluginId/version 和输出来源。

钩子按固定优先级顺序执行；Host 必选检查先行，最后再次核对策略版本与取消状态。策略结果采取拒绝优先，多个附加限制取交集；插件“允许”只能表示自身无附加限制。纯展示钩子只生成表示，不能改变执行结果及 effectState。

SDK 不能防止可信插件主动 import node:fs 或自行联网；违规插件必须拒绝发布/加载或人工移除。若将来需要强制约束第三方插件，应改为独立权限域与 RPC 服务；普通子进程不自动等于安全隔离。

## 4. 激活、失败与更新

状态为 installed → validating → activating → active → draining → disabled；失败进入 failed 并保留诊断。activate 收集临时注册表，全部验证成功再原子发布，失败释放已创建资源，不留下半个工具集合。

内置必需 Provider/文件工具失败使对应能力不可用，不能假装仍可完成任务；可选插件失败不阻止纯 Chat。提议 activate/dispose 10 秒、纯上下文/检查钩子 2 秒，超时拒绝本次能力。异步超时不能抢占阻塞 JS 主线程，若插件阻塞 Host，则由父进程存活监控终止 Host 并按中断恢复，不能承诺进程内可靠强制卸载。

活动 turn 固定插件集合、版本、核心工具 Schema、插件提示词贡献和 Provider。MCP 模块按服务器固定目录 generation，可在 step 边界选择其中的工具子集并保存 ToolSetSnapshot；这不允许插件热换代码或更改已审批参数。第一版不热替换执行代码：安装更新可暂存，等全部相关 turn 结束后停止 Host，再按新锁定集合启动。禁用先停止新调用，再等待或取消活动调用；进程重启才完成代码卸载。

插件更新不自动迁移 Session 历史：旧事件仍使用版本化 Schema 和纯读取适配。未知旧工具的历史仍可显示规范结果和产物；恢复不会为了重放历史去运行旧插件。插件自有存储迁移需要备份、版本和失败回滚。

## 5. 工作区身份、信任与占用

Workspace 是用户明确选定的目录，保存 canonicalRoot、文件系统身份、展示路径、信任状态和配置版本。首开只做元数据与受限指令发现；用户选择受限权限预设后才执行项目代码。识别 Git 只用于信息与默认忽略规则，不自动修改仓库、创建分支或上传内容。

路径规范化处理真实路径、大小写、Windows 设备路径和重解析点；Workspace ID 与用户会话归属分开。重新打开时核对根目录身份，移动项目由用户显式重定位并重新建立文件观察，不把同一路径下的新目录自动视作原项目。

桌面与 CLI 使用同一 OS 用户级工作区占用注册表，存放在不向 Agent 开放的协调目录；Session 数据库仍分别存放。注册表通过 OS 可释放锁串行维护，占用句柄随进程死亡释放；文本 PID 元数据仅用于提示，不是占用是否有效的依据。

可写 Session 执行 turn 前取得占用，turn 终止并清理命令后释放。相同物理目录、包含关系或已知别名发生可写范围重叠时排队/报 WORKSPACE_BUSY；不能只对字符串完全相等的路径加锁。临时获批的额外写目录也加入资源集合并按规范顺序取得锁，不能靠审批越过其他 Host 的占用。

第一版保证本机同一用户的 Praxis 实例之间协调；不宣称阻止编辑器、其他 OS 用户、网络共享或外部程序修改文件。因此写入前版本检查、执行后的事实核对仍必需。无法可靠锁定或识别的文件系统不开放可写 Agent。

## 6. 配置层与生效时机

配置分成身份/秘密、Provider、运行参数、工作区偏好和模型指令五类，不能用一个任意合并 JSON 文件承载全部权限。

| 来源 | 可配置内容 | 不能配置的内容 |
| --- | --- | --- |
| 部署/Host 安装策略 | 支持后端、最大预算、允许插件及 Provider 端点 | 不能通过模型修改 |
| 用户设置 | 默认模型引用、语言、权限预设、个人插件和执行偏好 | 不能超出 Host 硬限制 |
| 工作区 `.praxis/config.json` | 忽略项、明确的非秘密上下文偏好、建议验证命令 | 不能携带密钥、自动执行、加载插件、扩大权限或改服务端地址 |
| Session 设置 | 选用模型、当前权限和受限预算 | 变更必须来自已认证用户控制入口 |
| `AGENTS.md` | 给模型的项目约定 | 不作为可执行配置或授权来源 |

优先级为安装默认 → 用户 → 合法工作区字段 → Session 显式字段；最后受 Host 硬限制与当前授权求交。安全字段不按普通 last-write-wins 合并，未识别字段和类型错误给出可定位错误，不静默忽略。

每次解析产生不可变 EffectiveConfig，含来源清单、revision、hash。Provider/工具/插件选择在下一 turn 生效；权限变更立即使未消费授权失效，但运行中的进程需停止后才可应用更严格策略；显示语言、日志级别等非语义参数可即时变更。

工作区配置提出的“验证命令”只是建议，不执行文件中的 JS、Shell 插值或生命周期脚本。运行时调用仍需模型/用户发起工具并通过策略；建议 npm test 不表示 npm scripts 被视为可信代码。

MCP 用户配置由独立 McpConfigService 管理；工作区只能绑定用户已经确认的 serverId 并进一步限制工具，不从项目 JSON 自动启动程序、导入凭据或授予权限。MCP 的 token 不属于统一模型 Provider Key，不能因共享配置概念而混用。

## 7. 本地目录与数据边界

平台目录由 OS 应用数据 API 决定，不硬编码跨平台路径。逻辑布局：

```text
用户级 Praxis 协调目录/          # 桌面与 CLI 共用，只放占用及非秘密身份元数据
用户级 Praxis 插件目录/          # 已安装的不可变版本、锁定清单
Desktop 数据目录/
  users/<user-id>/sessions.db
  users/<user-id>/artifacts/
  config.json                   # 非秘密设置
  logs/
CLI 数据目录/
  users/<user-id>/sessions.db
  users/<user-id>/artifacts/
  config.json
  logs/
```

两类客户端不共享 SQLite。每个数据目录持有独占进程锁；第二个 CLI 不能同时写同一数据库，必须等待、退出或显式使用独立 profile。所有 profile 仍参与同一工作区占用协调。多 profile 不提供跨实例控制同一 Session 的能力。

Praxis 管理目录及系统凭据位置不放在 Workspace 可写范围内；用户把上级主目录选为 Workspace 时，仍需对子目录强制保护。模型输出产物引用只能读取当前 Session 可访问内容，不因此开放整个数据目录。

## 8. 未来平台化的迁移点

当前所有记录携带 ownerUserId 与资源归属，API 从认证上下文注入身份。平台阶段增加租户时迁移 owner scope 与授权检查，而不是现在建立无业务意义的空租户表。

本地 Session 未来同步必须有显式上传、内容与凭据过滤、格式版本和冲突处理；统一 Provider 配置不能当作已经同步会话的依据。远程 Host 接入复用领域命令与事件，增加传输认证、执行位置和资源映射。

一个控制端、多观察端要增加 Session 控制租约、过期时间和递增 epoch；每个写命令验证 epoch，观察接口始终只读。工作区占用、Session 单执行者、客户端控制租约各解决不同问题，不能互相替代。第一版不提前运行这套租约服务。

## 9. 验收

- 非兼容插件、路径逃逸入口、名称冲突、错误 Schema 和半激活失败不进入有效注册表。
- 工作区文件与模型输出不能安装插件、改变硬策略、读取其他用户或自行批准权限。
- 插件停用/更新不改变活动 turn 的实现；重放历史不执行插件副作用。
- 桌面与 CLI 对相同、嵌套和别名工作区的可写占用得到一致结果，崩溃后锁正确释放。
- 配置来源和生效时机可查询，秘密不进项目配置；重新定位和切换账号不继承过期授权。

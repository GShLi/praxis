# Praxis MCP 接入与上下文详细设计

设计批次：2026-11-02；补充更新：2026-11-03。状态：按用户要求补齐的详细设计提案，尚未实现。本文覆盖服务器配置、协议/连接、工具、资源、提示词及模型上下文；凭据、沙箱、审批、恢复和验收见[MCP 安全与运行保障](2026-11-02-praxis-mcp-security-design.md)。

## 1. 范围与产品边界

Praxis 作为 MCP Host，内部 MCP Client 连接外部 MCP Server。第一版提议把 MCP 作为可选 Agent 模块交付，用户配置并启用后可用；它不再只是一个“以后实现”的占位。完成设计不代表所有服务器天然兼容，也不代表已经实现。

| 入口/能力 | 本设计范围 |
| --- | --- |
| 桌面 Agent、CLI Agent | 本地 stdio 与远程 Streamable HTTP；工具、文本资源、用户选择的提示词 |
| Web ChatBot、桌面 ChatBot | 不连接 MCP，不注册 MCP 工具，不自动读取资源；维持纯回答边界 |
| Praxis Server | 不代理本地 MCP 请求、不执行用户 MCP 程序、不代存本轮本地 MCP 凭据 |
| Praxis 自身作为 MCP Server | 暂不对外暴露 Agent 或本地文件接口 |
| 高级 MCP 能力 | 不启用 sampling、Tasks、MCP Apps、Skills over MCP、URL elicitation；逐项给出拒绝行为 |

MCP 是外部能力协议，可信 Host 插件是可扩展宿主代码。内置 MCP 模块可以按插件形式组装，但第三方 MCP Server 不被 import 到 Host，不获得插件 SDK 或 Session 数据库访问权。

## 2. 规范基线与版本适配

本轮核对的官方基线为 [2026-07-28 规范](https://modelcontextprotocol.io/specification/2026-07-28)。该版本按请求携带协议及能力信息；旧版依赖 initialize。Praxis 提议支持 `2026-07-28` 和 `2025-11-25` 两个明确版本，不用日期大小比较推断未来版本兼容。依据：[版本规则](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)。

| 项目 | 2026-07-28 适配器 | 2025-11-25 适配器 |
| --- | --- | --- |
| 建立协议上下文 | server/discover 探测，逐请求元数据 | initialize → 校验协商结果 → notifications/initialized |
| HTTP | POST 对应 JSON 或请求级 SSE；正确生成协议与路由头 | 按旧版处理可选 session ID、GET 事件流与结束会话 |
| 服务器请求用户输入 | InputRequiredResult / MRTR | 独立的服务端请求，关联当前调用 |
| 工具目录变化 | 可选 subscriptions/listen；第一版以显式刷新为主 | 通知使目录失效，下次操作核对 |
| 取消 | stdio 取消通知；HTTP 关闭当前响应流 | 按该版本发送取消并关闭相关传输 |

新版 HTTP 不使用旧 session header 或 Last-Event-ID 恢复。Praxis 自己的 Session/SSE 游标与 MCP 传输是不同层，不能混用。实现以[新版 HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)、[stdio](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio)及[旧版生命周期](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)、[旧版传输](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)为依据。

配置 `protocol: auto | 2026-07-28 | 2025-11-25`，默认 auto。auto 先做无业务调用的 discover 探测：已识别的现代协议错误只在支持交集内重新协商，不降级；stdio 的非现代响应/超时才尝试旧握手，HTTP 按规范识别非现代 400 后尝试旧握手。401/403 进入认证处理，TLS/网络失败不作为降级证据。每次准备最多一次旧版回退，固定版本失败直接报错。需要 2024 HTTP+SSE 或其他版本的服务器报告 `MCP_PROTOCOL_UNSUPPORTED`，不盲试工具调用。

协议编码和 OAuth 基础设施采用官方 [TypeScript SDK v2 客户端](https://github.com/modelcontextprotocol/typescript-sdk)，实际依赖版本在实现时锁定并通过本文测试矩阵；这属于协议库，不替代自研 Agent 核心。SDK 的自动重试、自动发现、MRTR 回调和 spawn 必须可被 Praxis 限额、日志与权限入口约束，无法约束的行为不得直接启用。

## 3. 组件与调用路径

```text
用户配置 / 启用服务器
    → McpConfigService → 本地非秘密配置 + SecretStore 引用
Agent 生成工具调用
    → ToolRegistry / ToolExecutor → PermissionService
    → McpOperationManager → 版本适配器 → 受控传输
                                         ├─ stdio：Sandbox / ProcessRuntime
                                         └─ HTTP：EndpointPolicy / AuthBroker
    ← ResultNormalizer ← 规范结果 + 受控产物
    → SessionStore → ContextBuilder / 客户端事件
```

`McpCatalog` 保存带来源和版本的可用定义；`ToolSelector` 决定本 step 向模型暴露哪些定义；`McpOperationManager` 管理一次外部操作及其子请求，不推进另一个 Agent loop。所有凭据、身份、协议元数据、真实路径和连接 epoch 由 Host 注入。

一个 MCP 逻辑操作可能含探测、鉴权准备、目录校验、调用及 MRTR 续交；其外层是一个工具调用或用户控制操作。不能把这些协议子请求误记为多个模型决定，也不能用它们绕过 turn 总预算。

## 4. 配置模型与作用域

```ts
type McpTransport =
  | { type: "stdio"; executable: string; args: string[]; cwd: string;
      environment: Record<string, string>; secretEnvironment: Record<string, string> }
  | { type: "streamable-http"; endpoint: string;
      auth: { type: "none" | "bearer" | "oauth"; credentialRef?: string;
              registrationRef?: string } };

interface McpServerConfig {
  id: string;
  namespace: string;             // 创建后不随展示名改变
  displayName: string;
  ownerUserId: string;
  clientScopeId: string;
  revision: number;
  enabled: boolean;
  protocol: "auto" | "2026-07-28" | "2025-11-25";
  transport: McpTransport;
  accessProfileRef: string;
  capabilities: { tools: boolean; resources: boolean; prompts: boolean };
}
```

`secretEnvironment` 的值是 SecretStore 引用，不是明文。配置保存不启动程序、不安装包、不自动认证。更新携带 expectedRevision；配置身份由已登录客户端决定，导入配置不能指定任意 owner。配置改动产生新版本，删除/禁用立即阻止新操作并取消活动操作，不能等到下一个 turn 才禁止被用户关闭的服务器。

用户级配置属于当前客户端 profile；Workspace 只保存对已注册 serverId 的启用绑定和更严格的工具 allowlist。项目里的 `.mcp.json` 或其他工具配置只可作为显式导入来源，不能扫描后自动执行、继承 Key 或给服务器授权。桌面/CLI 的 MCP 配置第一版不自动同步；模型 Provider 的统一管理规则不因此改变。

stdio 要求用户选定安装好的可执行文件及稳定入口，记录文件身份/哈希；不把 npx -y、下载即运行、包管理器安装或 Shell 字符串作为默认启动方式。依赖安装由用户另行完成，入口变化需要重新核对信任。HTTP endpoint 必须是完整固定 URL，不能由工具参数改写。

启用流程为保存草稿 → 检查启动/端点和数据范围 → 用户确认访问配置 → 有界 test/refresh → 展示实际能力及不支持项 → 启用。明确的 test/refresh 是会运行本地程序或访问网络的操作，复用审批、存储及退出控制，不能假装为纯 JSON 校验。

## 5. 连接、进程与操作生命周期

配置状态为 disabled/enabled；一次操作状态为 preparing → connecting → negotiating → discovering → ready → invoking/waiting_input → closing → closed，异常可进入 auth_required、failed 或 interrupted。连接状态不直接作为 Agent Session 状态，只有关联调用真正等待用户时才设置 waiting_input。

第一版 stdio 采用 **每个逻辑操作一个受管进程**：准备沙箱 → 保存启动意图 → 启动 → 协议准备及必要目录校验 → 执行本次请求/MRTR → 关闭 stdin → 等待并强制清理 → 提交最终结果。探测若需临时进程，它也必须进入同一监督与清理流程。任何一个探测进程未清理，不再启动下一进程。

这样不保留两次工具调用之间的进程内状态；需要持续浏览器句柄、内存数据库或跨调用会话的服务器不属于本轮兼容保证，应报告需要持久服务器模式。它们可由用户自行运行并作为外部 HTTP 服务接入，但其服务生命周期不受 Praxis 控制，必须明确告知。

HTTP 逻辑连接可在同一 turn 内复用，但按 owner/client/session/server/config/auth 作用域隔离，不跨 Session 共享旧版 session ID、请求状态或认证。默认不开常驻资源订阅；显式刷新及调用前目录核验保证保守行为。关闭 Host 取消所有请求并释放客户端连接。

连接中断不会自动重放业务调用。元数据获取可在活动操作预算内有限重试；需要重新启动 stdio 时仍要取得执行位、检查策略并记录启动。无活动 turn 或用户维护操作时不后台重连、不自动启动 Agent。恢复 Session 也不启动 MCP 进程。

## 6. 工具目录、身份与 Schema

每次完整发现形成 CatalogSnapshot：serverId、configRevision、credentialScopeHash、protocolVersion、generation、fetchedAt、expiresAt、definitionsHash、各项内容对象引用。目录缓存是元数据，不是权限，也不作为服务器代码可信的证明。服务器自报的名称只用于展示；可信绑定来自本地配置和端点/程序身份。依据：[发现协议](https://modelcontextprotocol.io/specification/2026-07-28/server/discover)。

分页发现必须验证游标进展、重复名称、页数、条目数和总字节；先完整校验再提交新快照。传输/分页失败保留旧目录供查看但标 stale，不继续据此执行。单个不兼容工具可隔离并记录原因；重复身份、分页循环或目录结构损坏则拒绝整次目录。不会把不完整列表当作已确认删除工具。

工具真实身份为 `(serverId, rawToolName)`；内部 ID 为不可歧义的结构化键，模型名称使用 `mcp__<namespace片段>__<工具片段>_<12位摘要>`。namespace 与工具片段先转换为安全 ASCII，分别最多 12 和 32 字符，总长最多 64；原始二元组的规范 JSON 计算摘要，不用有歧义的字符串连接。保存完整映射，检测摘要碰撞并拒绝，不靠分割模型名称还原原工具名。更名后的历史保持旧映射。

保存 inputSchema/outputSchema 原对象与摘要；校验协议允许的 JSON Schema，并对 Provider 支持子集作显式投影。只删除展示性字段不能改变约束；不能表达的工具标 `MCP_SCHEMA_UNSUPPORTED`，不悄悄把参数变成任意 JSON。禁用远程 `$ref` 获取，限制嵌套和校验资源，不能让 Schema 触发任意网络请求。

HTTP 路由与参数镜像头由版本适配器依据已经校验的 Schema 生成，禁止模型设置认证头、Host、Cookie 或协议元数据。合法 `x-mcp-header` 只进入规范的参数头命名空间并经过编码；错误注解隔离该工具。出现 HeaderMismatch 先标记目录失效，不自动修参数重发业务调用。

MCP tools 的基础发现、调用、结构化结果和 annotations 参见[官方工具规范](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)。Praxis 将 annotations 作为不可信提示，不用 readOnlyHint/idempotentHint 自动授权或推导重试安全。

## 7. 模型工具的按需加载

保留 13 个核心内置工具。配置 MCP 后，Agent 可增加三个有条件注册的桥接工具及选中的服务器工具；不是把所有服务器的几百个定义直接加入 system prompt。

| 内部工具 / 模型名 | 参数与结果合同 |
| --- | --- |
| mcp.discover_tools / mcp_discover_tools | `serverId, query?, cursor?, limit?`，limit 默认 5、最大 8；返回匹配摘要、稳定名称、权限提示、selectedIds、未载入原因和下一游标；可触发该服务器有界发现 |
| mcp.list_resources / mcp_list_resources | `serverId, kind: resources|templates, cursor?, limit?`，默认 20、最大 50；返回带服务器与目录版本的 resourceRef/templateRef |
| mcp.read_resource / mcp_read_resource | 互斥 `resourceRef` 或 `templateRef+arguments`；结果为文本/结构化内容、来源、hash、截断及 artifact 引用 |

服务器由用户先启用，discover 不能创建服务器、修改启动命令或获取新授权。工具查询先使用有效目录；需要运行进程或联网时走同样的权限入口。发现成功的匹配项进入待选集合，只在当前 assistant 的完整工具组闭合后、下一 step 构造请求时激活；同一批次中模型凭猜测调用尚未暴露工具返回 TOOL_NOT_AVAILABLE。

一个 turn 的插件代码及 Provider 固定。MCP 每个服务器第一次成功发现时固定该 turn 的目录 generation；之后只改变此 generation 中被选中的工具子集。发生定义/端点/权限变化则旧绑定失效，要求新 turn 或显式停止后重建，不在已审批调用下热换 Schema。调用前核对实际目录：至少比较被调用工具、服务器 instructions 及访问绑定的摘要；变化返回 MCP_CATALOG_CHANGED。

目录摘要固定的是本机已审核视图，不能锁住远端部署。没有服务端条件调用/版本承诺时，list 与 call 之间仍可能变化；本设计不以 hash 宣称远端代码不可改变，也不据此自动相信其效果声明。

ToolSelector 提议最多 32 个 MCP 动态定义，合计不超过 `min(4000, floor(0.10 × L))` tokens，并同时服从 Provider 工具数限制和完整请求预算。L 沿用上下文设计。超额采用用户固定工具优先、最近实际使用优先的稳定规则，在安全边界淘汰；一个 Schema 单独超过预算则不暴露并明确原因。三个桥接工具本身也计入总 Schema 预算。

每个 step 保存 ToolSetSnapshot：核心版本、MCP server/config/catalog 版本、被选工具及模型名称映射。选择变化记录事件，可重建当时模型看见的能力。取消或压缩不删除这些快照；摘要不能激活工具或授权。

## 8. 调用流程与结果

```text
完整模型调用 + 当前 ToolSetSnapshot
  → 映射真实 serverId/rawName，校验参数与可用版本
  → 求权限、必要时审批并记录 intent
  → 取得执行位 / 凭据 / 受控连接，核对目录
  → 保存 dispatch 意图 → tools/call
  → 必要的 MRTR 人工输入 → 校验结果与已知效果
  → 清理本地进程或结束请求
  → 保存唯一规范 tool/result → 下一 Agent step
```

结果投影沿用 ToolResult，补充 `origin=mcp, serverId, catalogGeneration, operationId, protocolVersion, remoteEvidence`。远端 isError 映射 failed，协议/Schema 错误独立于业务错误；HTTP 200 不代表工具成功。`effectState` 独立计算，缺乏可验证事实时是 unknown，不能因为文本说“完成”就承诺本地文件已修改。

| MCP 内容 | 第一版处理 |
| --- | --- |
| text / structuredContent | 先校验、脱敏，按有界模型投影输出，完整受限对象存产物 |
| embedded resource 中的文本 | 保存来源及权限标签，作为数据；不把 URI 当成本机路径 |
| resource link | 保留名称/URI 与服务器归属，显式读取前不访问 URI |
| image / audio / 二进制 blob | 保存类型、大小和不支持标记；第一版不把 base64 塞进模型或承诺视觉/音频理解 |
| 未知内容块 | 明确 unsupportedContent，保留可安全展示元数据；不默默伪造成文本成功 |

不执行 HTML，不自动加载图标 URL，不因结果包含 URL 或 file URI 自动走 Host 文件/HTTP 客户端。外部内容及服务器 instructions 保持来源标签，不提升为系统规则。语义依赖被拒绝内容时，模型必须明确结果不完整；不会自动重跑已有副作用来获得另一种格式。

未定义的 `_meta` 字段不自动进入模型或普通日志；规范化保存只取合同允许的内容与安全来源信息。协议游标对模型表现为 Host 生成的 scope-bound 引用，绑定用户、服务器、配置/目录版本与查询，原始游标保留在该操作/缓存内；模型伪造或跨服务器复用时拒绝。

## 9. Resources、Templates 与 Prompts

资源按 `(serverId, uri)` 定位，不跨服务器串用。resourceRef/templateRef 是 Host 保存的目录/链接引用，不是任意 URL 代理；模板按已发现定义进行变量替换和长度校验，不展开环境变量、Shell 或本机文件。资源列表和按需读取的协议依据见[Resources](https://modelcontextprotocol.io/specification/2026-07-28/server/resources)。

resource link 可以产生新的候选引用，首次读取仍检查该服务器和数据访问范围；不会把远端 `file:///...` 解析为 Praxis 电脑上的文件。stdio 真正触及的本地文件仍受 OS 沙箱约束。读取结果保存内容 hash 和获取时刻；历史展示读取保存快照，不重新拉取一个已经变化的文档。

Prompts 通过用户控制接口 list → get preview → apply。用户选择与确认后，将确切内容快照作为带 provenance 的用户选用材料提交 queue/steer，不把服务端模板中的 assistant 文本伪造为本 Session 已产生的回答或工具动作。协议中的用户选择定位见[Prompts](https://modelcontextprotocol.io/specification/2026-07-28/server/prompts)。

预览时需要传给服务器的参数必须先让用户知道，不能确认预览后才补告知“代码已上传”。获取内容不自动加入模型上下文，apply 提交内容 hash 与新 requestId；模板在服务端后来变化不改变已预览内容。第一版只接受可安全转换的文本模板，非文本必需内容报不支持，不安装模板附带脚本、Skills 或插件。

资源/提示词更新第一版用按需重新获取；不自动订阅变化后唤醒 Agent。argument completion、资源长期订阅及全局知识库索引不作为本轮交付要求。

## 10. Elicitation 与 MRTR

交互式客户端提议支持 form elicitation，非交互 CLI 不声明该能力；URL 模式本轮不启用。只允许与一个正在进行的操作关联的询问，呈现服务器、字段与将发送的内容，复用 question/respond 的等待与去重服务；不把普通回答当作执行审批。禁止用表单收集 Key、密码或支付秘密。依据：[Elicitation](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation)。

新版适配器处理 `InputRequiredResult`，在人工答复后以新的 RPC id 续交原请求；`requestState` 原样回传，不解析，并且只属于同一个操作。依据：[MRTR](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr)。Praxis 把它视为已授权操作的协议续交，不是一次网络失败后的业务重试。

每轮输入先记录绑定 operationId、服务端 input ID、题目版本和字段；答复前复核用户、策略、参数和未取消状态。新信息若扩大目标资源或动作范围，重新进行具体操作审批；不能利用表单问“是否批准全部权限”扩大 Host 授权。拒绝/取消按协议表达，之后不自动换值继续。

requestState、OAuth 临时材料和旧版 MCP session ID 只在当前执行内存保留，日志保存必要摘要与状态，不进入模型、checkpoint 或普通导出。最多 8 次续交、每轮最多 12 个字段；空 inputRequests 只带 state 的续交同样受次数/总时间限制。崩溃后不从 checkpoint 自动续交。

sampling 不声明也不提供模型调用回调，防止 MCP Server 发起另一套模型费用与工具循环；收到未声明的请求报能力不支持。现代 roots 默认不声明；旧版确有需要时可由用户开启最小工作区根列表，roots 只是信息，不能代替 OS 沙箱。该功能在当前规范中已弃用，但不是已删除，参见[Roots](https://modelcontextprotocol.io/specification/2026-07-28/client/roots)。

Tasks 扩展本轮不协商，要求该扩展的工具在暴露/调用前标记不支持，不静默退化为后台任务；服务器即使支持 Tasks，也可调用它明确提供的同步路径。扩展的持久任务语义见[官方 Tasks](https://modelcontextprotocol.io/extensions/tasks/overview)。MCP Apps、Skills over MCP 和其他未知必需扩展同样明确拒绝；可选扩展不影响基础协议工具。

## 11. 预算与失败默认值

以下均为 Praxis 提案，受 Host 配置上限及 turn 剩余预算约束：

| 项目 | 默认 / 上限 |
| --- | --- |
| 单 Session 启用服务器 | 最多 8 个；按需使用，不启动 8 个常驻子进程 |
| 启动/协商 | 20 秒 / 60 秒；auto 的探测与回退共享此预算 |
| 一次目录 RPC | 10 秒 / 60 秒；临时故障最多 3 次总尝试 |
| 目录 | 每类最多 20 页、200 项；整个候选目录最多 8 MiB，Schema 单项 64 KiB |
| 工具/资源/提示词 RPC | 60 秒 / 10 分钟；progress 不延长硬截止时间 |
| 一个完整操作 | 默认 5 分钟，最多 30 分钟且不超过 turn 剩余时间；包含 MRTR 人工等待 |
| JSON 帧 / 单次规范结果 | 8 MiB / 2 MiB；解析前执行帧上限，结果超限记明确错误/截断而非透明无限缓存 |
| 单次模型结果 | 沿用 16 KiB 包络和本次 token 预算；产物计入 Session 200 MiB 限额 |
| server instructions | 每服务器 8 KiB，所有已选服务器合计最多 1000 tokens；超限不自动拼接 |
| 清理 | 共享 Host 5 秒退出总宽限，不为每个 Server 串行追加 5 秒 |

限额错误给稳定 code 和有用诊断，包括 MCP_AUTH_REQUIRED、MCP_CATALOG_CHANGED、MCP_SCHEMA_UNSUPPORTED、MCP_RESPONSE_INVALID、MCP_OPERATION_TIMEOUT、MCP_EFFECT_UNKNOWN。SDK 低层网络错误保留脱敏 cause，不能统一显示成“工具失败”。

## 12. 模块组织与实现边界

```text
packages/mcp-core/          领域类型、目录与操作状态、工具选择
packages/mcp-client/        官方 SDK 适配、新旧协议及受控传输
packages/mcp-auth/          本地 SecretStore、OAuth、端点与 issuer 绑定
plugins/tools-mcp/          三个桥接工具、动态工具注册、结果投影
packages/contracts/        控制 RPC、MCP 事件与保存格式
```

目录是逻辑拆分，初期允许合并包。client 不直接写 Session；通过接口返回事实，由统一存储服务提交。工具与 prompt/resource 导入不接触 Electron；用户交互由 Host 协议提供。MCP 官方 SDK 类型止于适配层，内部不以 SDK Client 对象或原始传输句柄作为持久数据。

首个开发切片建议使用无秘密、无外部副作用的 fixture：发现一个本地 echo 工具、读取一个固定文本资源、使用一个用户选择模板。其次验证远程 OAuth 与断流，再接真实服务器；不能用“某一个 MCP 能连上”代替全部合同验收。

# Praxis MCP 权限、认证、持久化与验收设计

设计批次：2026-11-02；补充更新：2026-11-03。状态：详细提案，尚未实现或通过真实服务器/三平台验证。与[MCP 接入设计](2026-11-02-praxis-mcp-design.md)共同构成完整模块合同；遵循[工具](2026-11-02-praxis-tools-design.md)、[系统沙箱](2026-11-02-praxis-sandbox-delivery-design.md)和[Session](2026-11-02-praxis-runtime-session-design.md)的通用约束。

## 1. 三层授权及信任边界

| 层次 | 授予的能力 | 不代表什么 |
| --- | --- | --- |
| 配置/连接同意 | 运行指定程序或连接特定端点，发送所需协议数据 | 不自动批准该服务器的所有业务操作 |
| 操作授权 | 调用确定工具/资源/模板并发送确定参数 | 不自动扩大本机文件/网络范围，也不授予模型 Key |
| 真实执行约束 | 本地 OS 沙箱、进程与数据访问合同 | 不能约束第三方远程服务器已经拥有的权限 |

MCP 不是沙箱协议。readOnlyHint、destructiveHint、idempotentHint、openWorldHint 和 serverInfo 均不可单独成为自动允许的证据。默认把未核验的服务器业务工具作为效果未知的外部操作，发起单次审批；用户可对经过核验的服务器/工具设定明确、可撤销的资源受限允许规则。规则绑定版本和作用域，不能仅凭名称包含 read/get 自动放行。Host 自身的目录桥接操作按已批准的连接、启动和数据范围处理，不仅因刷新目录就重复请求同一项同意。

同意调用的参数同时决定可能向服务器披露什么。默认不发送完整 Session、系统提示、其他服务器资源、用户账号内部 ID、Provider Key 或当前项目所有文件。模型参数中的本地内容离开电脑前仍适用当前外部数据范围；已知秘密在参数中出现时拒绝，不能通过“自动脱敏后改参”偷偷执行另一个未经审批的调用。

## 2. 本地 stdio 的沙箱与并发

ProcessRuntime 新增受管用途 `mcp-server`，使用专用 JSON-RPC stdin/stdout，区别于 stdin 关闭的普通 process.exec；模型不能通过 process.read/cancel 任意取得 MCP 原始协议流或其中的凭据。执行器共用同一原生沙箱与父死亡控制。

每个 MCP 操作从启动前到全部子孙清理完毕都占用当前 Session 的外部执行位；若 process.exec 尚在运行，返回 WORKSPACE_BUSY 或等待有界的控制请求，不能悄悄并行。期间不进行 fs.write/apply_patch、另一个 MCP stdio 操作或新命令。跨 Session 的可写工作区占用规则同样适用，额外授权路径纳入资源锁。

进程只获得本次服务器的最小文件/网络/临时目录权限。连接和 tools/list 也会运行服务器程序，所以必须先批准其启动范围并保存 intent。某服务器以“只读工具”名义启动的代码仍可能在初始化阶段写入，只有 OS 限制能约束该代码；不能把 discovery 统称无副作用。

第一版按操作回收进程，不让一个闲置但有写权限的 MCP Server 与文件修改工具长期并存。每次实例的沙箱权限在启动时固定；需要扩大范围必须关闭实例并为新操作重新取得授权，不能给已运行进程补一张纸面权限。

MCP Server 可按用户明确配置接收自己的服务凭据，例如代码托管平台的专用 token；只能从独立 secretEnvironment 引用注入。Praxis 身份凭据、LLM 厂商 Key 和其他 MCP Server token 永不继承。也不继承 SSH agent、Docker socket、通用宿主环境和登录 Shell 配置。

为服务器提供凭据意味着该服务器代码可以使用该凭据；OS 沙箱不是保护秘密免受接收者使用的机制。网络 deny/allow 的第一版粒度沿用主设计，若用户允许一般联网，不宣传为只能访问该 Key 所属域名。应优先给服务器最小权限的专用凭据。

## 3. HTTP 目的地与数据范围

远程 MCP 从本地 Host 直连配置端点，不经 Praxis Server。Host 的 EndpointPolicy 检查 HTTPS、固定 authority/path、实际连接地址、端点变更、代理和重定向；用户信息形式的 URL、fragment、嵌入 URL 的秘密和模型提供的替代 endpoint 均拒绝。

默认拒绝 loopback、私网、链路本地、云实例元数据和其他保留地址；用户确实连接内网或自行运行的 localhost MCP 时，先显式授予固定目的地例外，不能顺带开放整个内网。localhost HTTP 只作为用户主动配置的本机服务例外，不把它当成由 Praxis 管理或已沙箱化的进程。

DNS 检查与真实 connect 使用同一解析结果，验证 TLS 主机名，处理重解析/连接复用；代理必须是用户可信配置且保持可核验的目的地约束，不能由 server instructions 改写。redirect 默认不自动跟随，特别不携带 Authorization 跨源跳转。

OAuth 元数据、issuer、注册、token 端点也经过网络策略。它们可能与资源服务器跨域，需按经验证的元数据及用户选定 issuer 分别建立绑定，不能把“与 MCP 不同域名”一律误判为违规，也不能把任意提供的 URL 当作可信。

## 4. 凭据分类、存储与删除

| 凭据 | 第一版归属和用途 |
| --- | --- |
| Praxis 登录/API Key | 平台身份，仅发给 Praxis 服务 |
| 模型厂商 Key | 现有统一 Provider 配置，供模型请求使用 |
| MCP Bearer / 自定义服务 token | 当前用户+客户端 profile+server 配置，供对应 MCP 端点或进程使用 |
| OAuth token/registration | 再绑定 issuer、resource、clientId、已授予 scopes；不可跨 issuer 或服务器复用 |

MCP 配置只保存 credentialRef、状态和掩码。MCP 秘密保存在当前 OS SecretStore；不可用时只允许当前进程内存，结束后重新配置/授权，不静默降为项目明文 JSON。环境变量只作用户主动的一次性输入，取用后不得向其他子进程传播。

不向模型提供“填写 API Key”的工具，不用 user.ask/elicitation 收集秘密。用户通过可信设置流程输入；浏览器远端授权在系统浏览器中完成。普通 list/export/Session checkpoint 不含凭据、Authorization、refresh token、OAuth code 或 code verifier。

凭据变更使认证 epoch 增加，旧目录按凭据权限作用域失效，新操作重新发现；用户禁用/删除 MCP 配置立即停止接纳并取消活动请求/本地进程。删除本地 OAuth 凭据与远端撤销授权是两个操作：可显式尝试受支持的撤销接口并报告结果，本地删除不能宣称远端已撤销。

## 5. OAuth 流程

认证是控制流程，不由模型拼接授权 URL。HTTP 认证提议支持 none、用户设置 Bearer、OAuth 授权码 + PKCE；不是将 Praxis API Key 转发给任意 MCP Server。基础要求参考[授权规范](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)。

1. 用户显式连接/认证，或当前操作发现需要认证，进入 auth_required；记录待处理操作但不循环弹浏览器。
2. 读取资源元数据，发现授权服务器；验证元数据来源、issuer 一致性与端点。支持规范的 OAuth metadata/OIDC discovery 路径，按 issuer 隔离注册信息。依据：[授权发现](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery)。
3. 优先使用该 issuer 的预注册 client 信息；否则使用发布方托管的 HTTPS Client ID Metadata Document。第一版不实现 DCR，必要时要求用户提供合适的预注册信息，明确不支持的服务器。注册选择依据：[Client Registration](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration)。
4. 验证 PKCE 支持，生成随机 state 与 verifier，将预期 issuer、resource、redirect URI、scope、配置版本绑定到一次短期授权事务；使用系统浏览器展示服务器和范围。
5. 本机 AuthBroker 临时监听 loopback 的特定 callback，验证 state、issuer 响应与一次性事务后换取 token；失败不将 code 发到另一个 token 端点。参数 resource 绑定目标 MCP 资源，不能 token passthrough。依据：[授权安全](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations)。
6. 持久保存 token 时先在 SecretStore 成功写入再公布新 epoch；清除授权事务，关闭 callback 监听。验证后只继续尚未取消、仍获授权且未分发业务请求的准备阶段。

此 callback 是唯一明确的短时 loopback HTTP 例外，不是 Agent Host 控制接口，不处理文件、工具或其他 RPC；绑定具体地址、端口、路径与 5 分钟期限，单次消费、退出即关闭。redirect URI 必须与所选 client 注册/CIMD 匹配；随机端口仅在该授权服务器明确支持本机回环端口规则时使用，否则采用用户注册的固定回环地址，端口占用则报错。无可用 callback/浏览器的 CLI 不假装支持任意 device flow，返回可操作的认证要求或使用预置 Bearer。

刷新 token 按 credentialRef+issuer 单飞执行，轮换原子写入；已失效 refresh 不无限重试。403 insufficient_scope 显示新增 scope 请求，用户未同意不扩大范围。metadata/认证准备可在成功认证后重试一次；已发出的 tools/call 即使收到认证错误，也不无条件自动重放，先终止本次调用，再由显式新操作处理。

## 6. 审批与单次授权

ApprovalRequest 除通用字段外保存 serverId、配置版本、端点/程序身份、tool rawName、目录与 Schema hash、参数 hash、当前凭据作用域、外部数据类别和所需本地范围。展示实际工具/参数/目的地，不能只显示服务器给出的 friendly title。

内置政策先判断是否可执行；硬拒绝不可由 MCP 同意表单解除。需要审批时保持现有 waiting_approval 语义，用户拒绝就生成 denied 结果。未到分发前改变参数、身份、Schema、服务器或授权范围使票据失效。

每个逻辑操作只消费一次授权。其 MRTR 续交记录在相同 operationId 下，不消费同一票据去执行一个新的业务请求；任何扩权信息必须新审批。一般网络失败、重启进程或复制 JSON-RPC id 不构成原操作可安全重做的授权。

用户级允许规则也必须有有效范围和可见来源。第一版不提供“这个名字以后都允许”的无约束字符串规则，不把服务器自报 annotation 自动写入允许规则。权限收紧时关闭涉及的活动 stdio 实例/请求，后续操作重新准备；不能声称已改变第三方远端进程的系统权限。

## 7. 结果未知、取消与退出

| 情况 | ToolResult / 恢复行为 |
| --- | --- |
| 分发前拒绝/取消且能证明未发送业务请求 | denied/cancelled，业务 effectState=none；若本地初始化已运行，另保留其执行效果收据 |
| 完整合法业务结果 | succeeded 或 failed；根据证据记录 effectState，远程未验证写入为 unknown，服务器声明另存 remoteEvidence.reportedStatus，不增加新的 EffectState 枚举 |
| 请求已发送、响应超时或连接断开 | timed_out/unknown，effectState=unknown，禁止自动重发 |
| MCP isError 或输出 Schema 错误 | failed，保留安全的错误与已知效果；不假定没有部分写入 |
| 用户取消已分发调用 | 传播协议取消并关闭本地执行域；记录本地已停止及远端效果是否未知 |
| 取消后收到迟到结果 | 追加迟到事实，不能复活 turn、再启动工具或覆盖原结果事件 |

本地操作总 effectState 要合并启动、探测和业务阶段，不能业务尚未分发就把可能发生的初始化写入归零。原生限制能证明文件只读且网络拒绝时，可记录该已验证范围内无修改；这不构成对任意外部程序的普遍证明。

新版 HTTP 的响应流关闭和 stdio 取消通知由对应适配器发出；即使协议要求服务器停止，也不能在网络丢失时证明停止已发生。外部 HTTP 服务器本身不归 Praxis 管理，不能在应用退出时杀掉。退出停止本地 Agent、MCP 客户端及受管理 stdio 进程，不保证撤销已经提交的远端任务或外部变化。

第一版不请求 MCP Tasks 或其他明确脱离当前调用的持久任务。普通远程工具仍可能产生已提交效果；若业务硬性要求“退出即停止全部实际计算”，只能使用可由本机执行域控制的服务或另有已验证取消合同的服务，不能仅凭通用 MCP 作该保证。

关闭时先停止新操作/重连，再在同一总宽限内并行取消连接和清理本地执行域。迟迟不退出的 stdio 服务及子孙强制终止；清理失败保留 unknown 并阻止依赖它的后续文件修改，不报告正常完成。

## 8. 重试分类与恢复算法

元数据请求的有限重试仅限 discover/list、明确暂时性故障、同一配置及权限作用域；服务器程序重启本身仍是一个受审计的启动，不能因“list 是只读”跳过 startup 策略。RPC progress 不刷新操作总截止时间。

tools/call、resources/read、prompts/get 在业务分发后默认不自动重试；远端名称或 idempotentHint 不证明幂等。允许的 MRTR 续交与 HTTP 认证准备通过单独状态机识别，不能复用一般 retry 包装器。需要未来可靠自动重试时，应有明确业务幂等键及服务端保证，不能用 JSON-RPC id 冒充。

恢复顺序为：恢复 Session 纯状态 → 将未完成 MCP 操作标 interrupted/unknown → 关闭旧审批与问题 → 失效内存连接/session/state/token 使用快照 → 展示已知记录 → 用户新 turn 明确继续。不会恢复 OAuth 浏览器流程，不自动接管旧 MCP 任务或重放资源读取。检查用户要求的外部状态必须成为一个新的、经过权限检查的操作。

## 9. 持久数据与事件

| 数据 | 保存内容 |
| --- | --- |
| mcp_configs / workspace_mcp_bindings | 配置版本、归属、非秘密参数、引用和启用状态；独立配置存储 |
| mcp_catalog_objects | 不可变目录、Schema、instructions、来源/作用域 hash；缓存元数据无授权 |
| mcp_operations_projection | operationId、Session/turn/call 或用户维护操作、配置/目录/策略版本、状态、效果；可重建 |
| mcp_tool_bindings / toolset_snapshots | 原名称与模型名称映射、step 选中集合、定义内容引用 |
| artifacts / request_objects | 有界、脱敏的请求语义与结果/资源/模板快照及权限标签 |
| SecretStore | 服务 token、OAuth token/registration 中的秘密；不进普通数据库事件 |

事件新增：mcp/config_bound、catalog_committed/invalidated、tools_selected、operation_started、process_started/finished、request_intended、response_received、input_requested/answered、operation_finished、late_result_observed；用户维护流程写入独立 control audit，模型可见事实必须同时有 Session 引用。服务器提供的临时进度可以合并，终态必须持久化。

分发前先提交 intent；磁盘写入失败则不发送。结果提交失败立即停止依赖链，不能执行下一个工具后再补账。语义请求记录不含认证头；opaque requestState/session ID 只记录不可用于续交的摘要。原始 MCP 调试流默认不落盘，不能为了排错收集 refresh token。

资源/输出产物携带 serverId、原始读取范围和敏感分类。权限收紧后 artifact.read 也重新检查，不能通过已经缓存的秘密副本绕过限制。已经发送给外部模型或服务器的内容无法从对方记忆里撤回，审计不能宣称做到远程删除。

Checkpoint 保存活动操作标识、目录与工具集引用、等待状态及未知效果，不保存可恢复的连接/回调/授权秘密。重放事件只构造显示状态，历史重看不调用 MCP，不重新下载资源或模板。

## 10. Host 控制 API

| 方法 | 关键合同 |
| --- | --- |
| mcp/server-list、server-upsert、server-delete | 当前用户/profile 配置；upsert 带 expectedRevision，查询无秘密 |
| mcp/server-enable、server-disable | 用户选择；禁用停止活动操作、失效授权和目录绑定 |
| mcp/test、mcp/catalog-refresh | 用户主动、有界维护操作，明确会启动进程/联网，保存 audit |
| mcp/secret-replace、mcp/auth-start、mcp/auth-cancel、mcp/auth-forget | 可信主进程/CLI 通道专用，不进入模型工具列表或普通日志 |
| mcp/prompt-list、prompt-preview、prompt-apply | 用户选择、发送参数前确认、提交确定内容快照；apply 按 requestId 去重 |
| mcp/operation-cancel、mcp/status | 控制/查询所属操作，不接受任意 PID、URL、原始 MCP 方法 |

涉及网络/进程的控制操作同样要求有效 Praxis 身份、当前用户归属和权限，不能在未登录状态启动项目 MCP。维护操作使用 maintenanceOperationId，关联 Workspace，受 Host 退出、执行位及最长 5 分钟预算限制，不创建后台 Agent turn。

一切控制响应区分 accepted 与 finished；秘密响应禁止广播给 renderer。MCP 的 JSON-RPC id、Praxis RPC id、业务 requestId、operationId、toolCallId 和 Session seq 各自独立，不能彼此替代去重或鉴权。

## 11. 验收矩阵

| 编号 | 场景与预期 |
| --- | --- |
| M01 | 现代/旧版各自通过 stdio 和 HTTP fixture；固定版本不兼容报错，auto 回退不会重发业务操作 |
| M02 | 现代元数据/HTTP 头与 body 一致，含中文/特殊参数正确编码；旧 session/游标不串到现代传输 |
| M03 | 配置保存/项目导入不启动程序；test/发现时按授权进入沙箱，缺后端不绕过 |
| M04 | macOS/Windows/Linux 分别阻止未授权路径、网络、Host/凭据访问，验证进程子孙清理 |
| M05 | 每个 stdio 操作清理后才释放执行位；初始化写入、不退出、双重派生及进程崩溃有真实结果 |
| M06 | 不同服务器同名工具不冲突，长名/Unicode 名映射稳定；重名、哈希碰撞、异常 Schema 可诊断 |
| M07 | 分页循环、超限、单个不兼容工具、半目录失败不生成错误的有效目录或偷偷丢约束 |
| M08 | discover 后下一 step 才暴露工具，Schema/目录变化使旧授权无效；工具预算和 Provider 数量限制生效 |
| M09 | annotations、instructions、结果、prompt 和 elicitation 不能变成 Host 授权或新增工具/插件 |
| M10 | 远程请求只送明确参数，目的地/重定向/DNS/私网例外受控，Praxis/模型/其他 Server token 不串用 |
| M11 | OAuth PKCE/state/issuer/resource/redirect 验证与 scope 升级正确；元数据换 issuer 不复用注册或 token |
| M12 | SecretStore 不可用无明文回退；刷新单飞，禁用/删除取消操作；普通查询/日志/导出无秘密 |
| M13 | isError、200+业务失败、无效结构、含图像/音频/HTML 和超大输出得到明确结果，不伪造已理解或成功 |
| M14 | resourceRef 不跨服务器/用户；链接不自动下载，file URI 不读取 Host 文件，历史使用内容快照 |
| M15 | prompt 先预览再应用，相同 requestId 不重复输入；返回 assistant 模板不伪造实际执行历史 |
| M16 | MRTR 输入隔离、原样 state、新 RPC id、拒绝/取消/次数上限正确，非交互 CLI 不假装支持表单 |
| M17 | 工具发送后断流/超时/401/崩溃均无自动重放，迟到结果只补事实，外部效果 unknown 保留 |
| M18 | 分发前数据库失败无请求；响应后落盘失败不继续副作用，checkpoint 重放不连接服务器 |
| M19 | 退出停止本地客户端及受管 MCP，HTTP 已提交效果不谎称撤回；Tasks/sampling/未知必需扩展明确不支持 |
| M20 | ChatBot 伪造 MCP 调用无执行入口，跨用户/Session/Workspace 的配置、产物和操作不能串用 |

测试使用本地 fixture Server、受控 HTTP/OAuth 模拟服务、假凭据和临时目录，覆盖 JSON 与 SSE 两种 HTTP 响应、MRTR 和故障注入；三平台隔离测试必须运行真实子进程。真实 MCP 只做少量无外部写副作用的互操作验证，未知结果重放检查不对生产业务发起重复写入。

## 12. 两个可审阅的完整案例

**本地资料查询并修改页面：** 用户启用只读文档 MCP，授予指定 docs 读取和网络 deny。Agent 调用 discover，Host 受控启动/列目录/回收；下一 step 出现 query 工具。调用 query 时新实例验证目录并查询，返回文本后清理；Agent 再用 fs.read/apply_patch 修改 index.html。MCP 不继承文件写权限，两个执行阶段没有闲置可写服务竞争。所有来源和工具集均可回放。

**远程创建工单后断流：** 用户批准指定服务器、项目和工单参数，Host 提交 intent 并发送工具请求；连接断开。工具记录 unknown，模型说明无法确认工单是否创建，不能直接重试创建。用户要求核查时，新操作在相应权限下查询可能的工单；找到后保存该证据，未找到也不证明原创建绝不会稍后完成。关闭 Praxis 只停止本地等待与客户端，不宣称取消了已提交的工单。

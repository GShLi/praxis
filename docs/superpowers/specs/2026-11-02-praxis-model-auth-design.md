# Praxis 模型接入、身份、凭据与统一配置设计

日期：2026-11-02。状态：详细提案。用户已确认本地客户端取得统一配置后直连模型厂商；接口、时限及存储实现为提案。关联[总体设计](2026-11-02-praxis-design.md)、[协议设计](2026-11-02-praxis-protocol-chat-design.md)。

## 1. 配置管理与请求路由

模型提供商可以从服务端管理入口或客户端编辑，提交到同一用户级配置服务；服务端是版本权威。第一版不维护另一套可独立修改的客户端厂商 Key。客户端只管理缓存和当前选择，不把 ChatBot/Agent 拆成两份凭据。

| 场景 | 执行模型请求的位置 | 模型输入输出经过 Praxis Server 吗 |
| --- | --- | --- |
| Web ChatBot | 服务端 ChatRuntime | 是，Web 对话由服务端执行并保存 |
| 桌面 ChatBot | 本地 Host 中的 ChatRuntime | 否 |
| 桌面 Agent | 本地 Host 中的 AgentRuntime | 否 |
| CLI Agent | 本次 CLI 的 Host | 否 |

桌面 ChatBot 使用本地 ChatRuntime 是为落实客户端直连而提出的具体部署方案。桌面与 CLI 仍请求 Praxis Server 进行身份、模型配置和凭据交付，但服务器不代理其推理流量，也不上传本地 Session、文件及工具输出。厂商自然会接收模型输入；“直连”不表示数据不离开电脑。

配置可从任一入口维护，第一版统一由服务端加密保存厂商 Key。本机不持久化第二份厂商 Key；这也意味着首次运行及开始新 turn 需要连接配置服务。离线配置分支和本地专属 Provider 留到以后独立设计。

## 2. Provider 数据模型

```ts
interface ProviderConfig {
  id: string;
  ownerUserId: string;
  providerType: string;
  baseUrl: string;
  credentialRef: string;       // 不可凭此直接读取密钥
  revision: number;
  credentialVersion: number;
  enabled: boolean;
  models: ModelDescriptor[];
  defaultChatModel?: string;
  defaultAgentModel?: string;
}

interface ModelDescriptor {
  id: string;
  contextWindow: number;
  maxOutputTokens: number;
  toolCalling: boolean;
  streaming: boolean;
  reasoningMode: "none" | "supported" | "required";
  capabilityRevision: number;
}
```

默认模型可以按模式不同，但都引用同一个 ProviderConfig。厂商模型列表、上下文容量和能力不能仅由模型名称猜测；适配器维护有来源及版本的描述，允许用户显式覆写容量并提示其责任。模型存在于列表不等于支持 Agent tools。

修改配置必须携带 expectedRevision；冲突返回 `CONFIG_CONFLICT`，不最后写入者覆盖全部设置。删除先禁用并递增版本，撤销新使用授权，再按保留策略清理密文；活动 turn 固定原配置快照，不进行静默模型切换。

普通查询只返回 `keyConfigured`、服务端生成的掩码和版本，不返回明文。创建/替换 Key 是单独的只写接口，响应及审计不回显输入；删除默认模型不会偷偷改用其他收费模型。

## 3. 本地直连的凭据流程

```text
客户端完成 Praxis 认证
  → Host 经凭据桥取得本次所需的 Praxis 身份材料
  → begin-use(providerId, modelId, expectedRevision, mode, turnId)
  → Server 校验用户、配置版本、状态、模型能力及 client:direct 使用范围
  → 专用响应返回配置快照和对应厂商 Key
  → Host 在内存中交给该 Provider 适配器
  → Host 直接向已验证的模型端点发送请求
  → turn 结束释放引用；退出后不保留厂商 Key 缓存
```

`begin-use` 使用 HTTPS POST，响应设 no-store；访问日志、中间件、异常上报和 RPC 调试不得记录请求/响应秘密。密钥不能放 URL、启动参数、普通 Host 事件或 renderer 可读状态。桌面渲染层可以提交用户刚输入的 Key，但不能从查询接口读回已有 Key。

认证桥只允许受控主进程向自己的 Host 传递身份材料，私有通道需验证 Host 实例。服务端的 client:direct 权限表示允许该账号凭据取得自己的厂商 Key；不是证明请求必然来自正版 Host 的远程认证。持有此权限的本地客户端可以得到明文 Key，这是选择直连的实际信任边界。

本地身份凭证提议 15 分钟有效；每个新 turn 仍必须 begin-use 在线检查配置与身份状态，不能只凭未过期缓存绕过配置删除。刷新失败时输入可保持 queued，但不得开始执行；客户端显示明确原因。已开始的 turn 可以在自身预算内继续使用快照，不因 Praxis 暂时断网中断。

MCP 是另一类外部连接，模型凭据不得提供给 MCP Server 或 MCP sampling。其服务 token/OAuth 由[MCP AuthBroker](2026-11-02-praxis-mcp-security-design.md#5-oauth-流程)独立管理，第一版保存在当前客户端 SecretStore；不新增 ChatBot/Agent 两套模型厂商 Key，也不通过 begin-use 下发 MCP token。

轮换、禁用或删除影响之后的新 turn。第一版不承诺远程销毁已经交付到客户端内存的秘密，也不远程终止活动 turn；若需立即撤销已交付 Key，应在厂商处撤销。厂商返回认证失败时停止当前模型请求，不重新尝试旧 Key。

Web 不使用此明文交付接口。其服务端 ChatRuntime 经内部 SecretResolver 读取同一 credentialVersion；Web 登录 Cookie 默认无 client:direct 权限，凭据交付端点不开放浏览器跨域访问。桌面/CLI 使用的登录票据或 Praxis API Key 具有相应客户端范围。

## 4. 统一模型接口与流协议

`ModelClient.stream(request, signal)` 返回标准事件流。Request 包含规范消息、工具 Schema、模型参数和语义快照 ID；传输层另外取得凭据，不能序列化进 Request Snapshot。

| 事件 | Runtime 行为 |
| --- | --- |
| response_started | 保存厂商请求 ID 等非秘密关联信息 |
| text_delta | 临时显示，按批次持久化部分回答 |
| tool_call_delta | 按 index/id 拼接参数；仅预览，不执行 |
| usage | 记录厂商提供的累计用量，避免增量重复累加 |
| response_completed | 校验完整消息、工具 JSON、结束原因，然后提交 |
| response_failed | 规范化故障，记录部分输出与是否允许重试 |

推理/opaque 元数据由适配器按协议保存和回传，不把厂商未提供的隐藏推理补写进会话，也不把 opaque block 当成普通文本拼接。模型无工具能力、Schema 不支持、输出未完整结束时不得启动工具。

第一版实现 DeepSeek 的 Chat Completions 适配器，按[官方协议](https://api-docs.deepseek.com/api/create-chat-completion/)处理消息、工具调用和流事件；具体模型 ID、窗口及参数以实施时的能力快照为准。不因为 URL 兼容就宣称支持所有 OpenAI-compatible 服务。厂商特有的推理字段与连续工具调用要求由适配器负责并用固定响应样本验证。

Agent 中 finish=length/异常断流产生 incomplete，保存部分内容但不执行其中的工具调用；已提交的完整 assistant message 不因后续网络异常再请求一次。ChatBot 的截断回答保存为 incomplete，供用户明确继续或重新生成。

## 5. 超时、重试和用量

提议连接建立 15 秒、首个有效事件 60 秒、流空闲 60 秒、单次请求总时长 10 分钟；推理模型可以在能力配置中显式提高首事件时限，总时长仍受 turn 剩余预算限制。心跳/注释包不能无限延长有效内容等待。

仅对尚未接纳任何有效模型输出的连接故障、429 和可重试 5xx 自动重试；最多 3 次总传输尝试，指数退避加随机抖动，遵守有上限的 Retry-After。主动取消、401/403、配置错误、非法 Schema 不重试。流中已有内容时停止并标记中断，避免悄悄替换用户已见回复。

明确的上下文超窗可按[上下文设计](2026-11-02-praxis-context-design.md)改变视图后再请求，但仍消耗同一步尝试预算。发送后响应丢失可能仍被厂商计费；本地 requestId 不能保证厂商 exactly-once，不把自动重试称为无成本重试。工具副作用不由模型网络重试机制重放。

usage 保存 input/output/cache/reasoning 的厂商原字段及规范解释，缺失标 unknown，估算标 estimated。第一版统计本地使用量，不建设平台计费；直连意味着服务器无法独立保证用户上报的 token 数真实，不能据此做不可篡改计费账本。

## 6. 账号、登录与 Praxis API Key

第一版提议管理员创建账号，无公开注册和邮件找回。服务端管理 CLI 通过交互输入完成初始管理员及密码重置，不把密码放命令行参数或输出到日志。所有管理操作产生不含秘密的审计。

密码使用受维护库实现 Argon2id，基线遵循 [OWASP 密码存储指南](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)，并按服务器负载测量成本；不自制哈希、加密或随机数算法。登录错误不暴露账号是否存在，按账号及来源限速。

Web 使用服务端会话与 HttpOnly、Secure、SameSite Cookie，所有修改接口验证 Origin 与 CSRF token。桌面账号登录采用短 access token 和可轮换 refresh token；API Key 登录作为另一种客户端方式。token 服务端只存摘要及元数据，刷新事务轮换并检测旧 refresh token 重用。

Praxis API Key 提议为可识别前缀、随机公开 ID 和至少 256-bit 随机秘密；仅创建时显示一次，服务端保存秘密摘要。范围为 profile:read、providers:read、providers:write、client:direct 等明确集合；创建时不能超过当前用户权限。Web 会话可显式创建客户端 Key，但没有通用“读回任意凭据”接口。所有范围始终受 ownerUserId 约束。

登录票据建议 access 15 分钟、refresh 最长 30 天且可撤销；API Key 可设期限、默认 90 天。退出登录取消该客户端活动执行，释放内存凭据，撤销该登录会话的 refresh token；不因为退出一次客户端就吊销用户所有 API Key。

桌面与 CLI 的 Praxis 凭据优先放 macOS Keychain、Windows Credential Manager、Linux Secret Service；无法使用系统秘密存储时提供仅内存会话或用户主动设置环境变量，不自动退回明文配置文件。执行命令环境必须剔除这些变量。

## 7. 服务端存储与接口

| 表 | 关键字段 |
| --- | --- |
| users | id、账号、password_hash、status、created_at |
| auth_sessions | id、user_id、token_hash、type、scope、expires_at、revoked_at、refresh_family |
| api_keys | id、user_id、prefix、secret_hash、scopes、expires_at、revoked_at、last_used_at |
| provider_configs | id、user_id、revision、type、base_url、model_config、credential_id、enabled |
| provider_credentials | id、user_id、version、ciphertext、nonce、key_version、state |
| audit_events | actor、operation、resource_id、time、outcome、request_id；无 Key 或对话正文 |

厂商 Key 使用标准认证加密，由独立于数据库的服务密钥加密；用户、配置 ID 和版本绑定到认证附加数据，避免密文串用。主密钥通过部署秘密管理提供，轮换保留旧解密版本直到重加密验证完成。数据库备份不包含同一位置的解密主密钥。

接口提案：`/v1/auth/login|refresh|logout`、`/v1/me`、`/v1/api-keys`、`/v1/providers`、`/v1/providers/:id/credential`、`/v1/client/provider-uses`。列表/删除/更新分别使用明确 HTTP 方法。标准错误含 code、safeMessage、retryable、requestId；不得透传 Authorization、密码、厂商原始请求体。

若发行方提供 MCP OAuth 的 Client ID Metadata Document，仅托管公开的静态客户端元数据（client ID、名称、匹配的 callback 等），不由此代理 MCP、存取其 token 或接收本地 Session。没有可用且匹配的元数据时使用预注册信息，不编造一个不存在的公开 URL。

服务器调用用户配置的 baseUrl 必须防止 SSRF：默认仅支持内置厂商 HTTPS 端点；自定义端点由管理员启用并约束目的地，检查实际连接地址、DNS 重绑定和重定向，不自动跟随携带认证的跨源跳转。本地直连也不接受从模型输出动态改 baseUrl；更改接收 Key 的目的地是用户配置操作并使旧使用快照失效于下一 turn。

## 8. 验收

- 同一份 Provider 配置可供四条使用路径引用；本地推理抓包不经过 Praxis Server，Web 使用服务端运行。
- 普通模型配置查询、Session 导出、错误日志、子进程环境、桌面 renderer 均无法读回已保存的 Key。
- 两个客户端并发修改配置产生版本冲突；删除后 begin-use 拒绝，活动 turn 的既有快照规则明确。
- 无 Praxis 身份、错误用户、无 client:direct 范围不能取得厂商 Key；API Key 与厂商 Key 不可互换。
- 流式工具参数未完整、重复 chunk、认证错误、429、断流和超窗均有有限且不重放副作用的处理。
- 服务端凭据轮换、refresh 重用检测、用户禁用、退出与 CSRF/SSRF 边界有独立集成验证。

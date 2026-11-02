# Praxis 执行核心、Session 与持久化设计

日期：2026-11-02。状态：详细设计提案；已确认的产品决定以[总体设计](2026-11-02-praxis-design.md)为准。参考事实与取舍见[参考分析](2026-11-02-praxis-reference-analysis.md)。本文不包含代码实现。

## 1. 运行时职责

`SessionService` 负责接纳输入、查询、元数据和归属校验；`SessionCoordinator` 负责每个会话唯一执行者；`AgentRunner` 负责 Turn/Step；`ContextBuilder` 构造请求；`ModelClient` 访问厂商；`ToolExecutor` 执行工具；`SessionStore` 保存事实。不能让 HTTP handler、桌面窗口或 Provider 自己再推进一套 Agent 循环。

同一 Session 的状态修改串行提交，但不能持有会话互斥锁等待 LLM、工具或人工回答。外部工作通过带 attempt/generation 的完成消息回到协调器，控制入口可以同时接纳取消、输入和审批。过期完成消息只能记录迟到事实，不能推进已结束的 turn。

第一版每个 Host 默认最多 4 个活动 Agent turn，不同会话隔离；超额输入可持久化为 queued 并显示排队原因。每个 Workspace 同时一个可写 Session，桌面和 CLI 通过系统级占用锁协调；不是集群租约。只读会话也不能绕过其他会话的敏感文件策略。

## 2. 领域对象与身份

| 对象 | 必要字段或含义 |
| --- | --- |
| Workspace | `id, canonicalRoot, filesystemIdentity, trusted, configRevision`；路径是定位信息，不能替代身份 |
| Session | `id, ownerUserId, kind, workspaceId?, clientScopeId, formatVersion, latestSeq, archivedAt?` |
| Input | `id, requestId, mode, text, acceptedSeq, state, expectedTurnId?`；state 为 pending/claimed/suspended/cancelled |
| Turn | `id, inputIds, status, startedAt, endedAt?, stopReason?, budgetSnapshot` |
| Step | `id, turnId, ordinal, status, requestSnapshotId`；一次逻辑模型决策与对应工具阶段 |
| Attempt | `id, turnId, purpose, operationId, ordinal, providerRequestId?, status, usage`；purpose 为 agent_step/chat_generation/compaction，operationId 指向对应 step/generation/compaction；同一操作有限重试 |
| ToolCall | `id, stepId, providerCallId, toolVersion, argumentsHash, status, effectState` |
| Execution | `id, toolCallId, hostInstanceId, processState, outputArtifactIds`；不持久化可重用的进程句柄 |
| McpOperation | `id, callId?, maintenanceOperationId?, serverId, configRevision, catalogGeneration, status, effectState`；关联零到多个协议子请求/受管进程，不等同模型 step |

身份由 Host 创建，Provider tool-call ID 仅在对应 assistant message 内关联；组合为 Host 调用 ID后持久化。相同厂商 ID 在其他请求出现不能被误去重。所有人类输入、Agent 输出、环境注入和插件内容保留来源。

## 3. 输入接纳与调度

`session/prompt` 参数为 `sessionId, requestId, mode: queue|steer, text, expectedTurnId?`，默认 queue。接纳事务同时写入 request 去重记录、`input/accepted` 事件和 pending 投影，提交后返回 accepted。相同作用域与 requestId、相同规范化内容返回原接纳结果；内容不同返回 `REQUEST_CONFLICT`。

空闲会话准备启动时先预留 turnId，进行 begin-use 配置/凭据和工作区占用检查；外部等待不持有会话互斥锁，也不提前移除 pending 输入。检查成功回到协调器，核验输入仍待处理，再在同一事务领取并记录 turn/started；迟到配置不能启动已取消输入。当前服务不可用时保留 queued 并报告原因，由客户端重试/连接恢复唤醒；应用重启后仍遵守 suspended 和手动恢复规则。

运行中 queue 按接纳顺序等待下一 turn。steer 要求 expectedTurnId 匹配当前 turn，在下一个 step 边界批量领取，不改已发请求或正在执行的工具。无活动 turn 时，没有 expectedTurnId 的 steer 可开始新 turn；携带已结束 expectedTurnId 的旧请求拒绝，不偷偷改变目标。

起始边界领取一个 queue 输入及当时可领取的 steer；运行中的边界只领取目标匹配的 steer。领取与 visible message 投影在同一个事务中提交，未领取输入不是模型历史。完成判定与最后一次待领取 steer 检查由协调器原子排序：若接纳先发生则继续本 turn，若结束先发生则拒绝过期 steer。

队列限制提议每 Session 100 条、每条文本 256 KiB；达到上限在接纳前拒绝。queue/steer 不重置 turn 已用预算；用户要求扩大预算通过独立控制命令，不能靠持续追加输入形成无限执行。

## 4. Turn 与 Step 算法

```text
接纳并领取输入 → turn/started
  ┌─ 检查取消、工具授权及策略版本、预算、工作区与插件快照
  │  领取可用 steer，刷新有变化的项目指令
  │  在安全边界确定 MCP 已选定义，保存 ToolSetSnapshot
  │  构建 Context View，必要时压缩，保存 request/snapshot
  │  step/started → attempt/started → ModelClient.stream
  │  收集完整 assistant message，验证结束原因和工具调用
  │  先提交 assistant/message，再按顺序处理完整工具批次
  │  每个 tool/result 提交后才用于后续请求
  │  step/finished
  └─ 有工具结果、新 steer 或活动执行待处理 → 下一步/等待执行事件
无继续条件 → 清理受管理进程 → turn/finished
```

第一版不在工具参数流尚未结束时执行工具；只有消息完整且 tool call JSON 合法后才进入执行阶段。一个返回含多个调用的 assistant message 属于一个原子协议组，每个调用必须得到成功、拒绝、失败或未执行的结果。用户取消时未启动的调用补充 `NOT_EXECUTED_CANCELLED`，不伪装成已经执行。

MCP 目录首次发现和工具选择也是有记录的输入变化，下一 step 才生效；同一模型批次不得猜测调用尚未暴露工具。插件代码与核心定义固定，远端目录按服务器固定本 turn generation；更新使旧绑定失效，不直接替换已批准调用。MRTR 询问属于现有工具操作内的等待，不产生额外 Agent loop。

模型在工具批次前附带的解释属于该 assistant message，不自动视为最终回答。finish=stop 且没有工具调用可成为最终候选；若无待领取 steer、未解决工具或等待输入，则进入 settling，停止剩余命令并核对结果，再提交终态。仍有活动命令或清理失败不能提交正常完成。final answer 不等于外部任务已客观成功，验证证据不足必须如实表述。

长命令 returning running 结束该次工具调用，Execution 独立存活；协调器在下一安全边界投递已持久化的完成通知。无其他工作时等待执行事件或一次有界 read，不通过高频调用模型轮询。命令完成只继续原 turn，不自动创建新 turn。turn 清理命令的第一版约束沿用工具设计。

## 5. 状态转换及控制

| 当前状态 | 事件 | 下一状态/结果 |
| --- | --- | --- |
| idle | 合法输入领取 | running，创建 turn |
| running | 需要权限 | waiting_approval，保留调用身份 |
| running | 需要用户答复 | waiting_input |
| waiting_approval | 同意/拒绝 | running，执行或返回拒绝结果 |
| waiting_input | 有效答复 | running，形成 user.ask 结果 |
| 任意活动状态 | cancel/shutdown | cancelling，先保存取消意图并传播 AbortSignal |
| cancelling | 清理及终态提交 | idle；turn 为 cancelled 或 interrupted |
| running | 正常结束/错误/预算耗尽 | idle；turn 为 completed/failed，带明确原因 |
| 恢复发现未结束执行 | recovery | interrupted，等待用户继续 |

运行状态 running 可附 `phase: preparing|compacting|model|tools|waiting_process|settling`，避免用多个互相矛盾的布尔值。cancel 响应表示已接纳取消，不表示进程已停；通过终态事件确认。普通断流不会将工具的真实成功改成取消。

提议预算：每 turn 100 个逻辑 step、150 次总模型尝试（含重试和摘要）、累计 200 个工具调用、60 分钟墙钟时间；运行、等待人工、重试、压缩都计墙钟。Token 总限额由模型配置显式设置，可为未设置，但请求数和耗时不得同时无限。达到上限直接终止执行并给出运行时状态说明，不额外启动不计预算的总结请求。用户可通过 session/set-budget 在 Host 硬限额内显式调整，模型输入本身不能调整。

相同工具名、参数摘要及同类失败连续出现 3 次且没有用户新指示时停止该重复链，返回 `NO_PROGRESS`；这是循环保护，不推断语义任务必然无解。审批拒绝后不能改变工具绕过相同边界。

## 6. 事件与提交边界

事件公共字段：`sessionId, seq, eventId, type, schemaVersion, createdAt, source, turnId?, stepId?, attemptId?, callId?, payload`。seq 在单个 Session 内连续递增，在同一事务中从 latest_seq 分配并更新，不使用可能回滚后跳号的全局数据库 sequence 充当会话游标。真实运行句柄、密钥和系统进程权限票据不得进入 payload。

| 事件族 | 保存内容 |
| --- | --- |
| session/created、archived、deleted | 身份、模式、生命周期；删除保留独立审计墓碑 |
| input/accepted、claimed、suspended、cancelled | 输入来源、领取归属和队列状态 |
| turn/started、cancel_requested、finished | 预算快照、结束原因及使用量 |
| step/started、finished；attempt/started、finished | 请求归属、Provider 路由版本、有限重试结果 |
| instruction/snapshot、runtime/snapshot、request/snapshot | 模型可见内容或不可变对象引用和摘要 |
| assistant/partial、assistant/message | 批量保存的部分输出、完整规范消息 |
| chat/generation_started、generation_finished、candidate_selected | Chat 候选归属、终态及当前选择，不覆盖旧消息 |
| tool/planned、started、result | 参数、执行意图、结果与效果状态 |
| process/started、finished | 执行 ID、关联调用、已确认终态 |
| permission/changed；approval/asked、decided、consumed | 策略版本和单次授权审计，不含可复用凭据 |
| question/asked、answered、closed；plan/updated | 用户交互与计划版本 |
| context/compaction_started、committed、failed | 源版本、范围、摘要引用及新版本 |
| recovery/applied；checkpoint/created | 恢复处理和已提交快照位置 |
| mcp/catalog_committed、tools_selected、operation_started/finished 等 | 外部能力来源、选中定义、请求意图、结果/未知效果与交互；完整字段见 MCP 运行保障设计 |

状态投影与事件在同一数据库事务提交，内存和通知只在 commit 后更新。事件是权威，投影是可重建缓存；必要的新事实不能只保存在投影。append 不得在尚未提交时返回 accepted。运行中的输出 delta 可以临时通知，按 250ms 或 8 KiB 批量保存部分回复，取先达到者。

工具外部副作用与数据库不属于同一事务。`tool/started` 成功落盘是执行前提；完成后提交结果失败，则停止依赖链并尝试持久化 unknown，不能声称事务回滚了文件。数据库不可写时保留内存事实、停止新副作用并给出诊断；崩溃恢复按未知处理。

## 7. 数据表与索引

Agent 本地 SQLite：启用外键、WAL、可靠提交配置，数据放本机磁盘，不支持把 SQLite 文件放网络共享盘。一个 Host 数据目录有单写进程锁。数据库访问使用受维护驱动与参数化 SQL，具体驱动版本在实施时锁定。

| 表 | 核心列/索引 |
| --- | --- |
| sessions | id PK、owner_user_id、kind、workspace_id、scope_id、latest_seq、format_version、archived_at；用户+更新时间索引 |
| events | (session_id,seq) PK、event_id UNIQUE、type、schema_version、payload_json、关联 IDs；turn/step 索引 |
| requests | (owner_user_id,scope_id,request_id) UNIQUE、payload_hash、accepted_event_id、response_json |
| inbox_projection | input_id PK、session_id、mode、target_turn_id、state、accepted_seq |
| turns_projection / steps_projection / attempts_projection | id PK、session_id、当前状态和关联事件位置；attempt 保留 purpose/operation_id，摘要调用也计入预算 |
| messages_projection / tools_projection | 内容/结果引用、排序位置；所有值可从事件重建 |
| contexts | (session_id,version) PK、parent_version、base_seq、ordered_entries_json、summary_id? |
| snapshots | id PK、session_id、through_seq、snapshot_version、checksum、state_json |
| artifacts | id PK、session_id、relative_path、content_hash、size、classification、state |
| artifact_refs | artifact_id、event_id 或 snapshot_id；用于可验证清理 |
| instruction_objects / request_objects | 内容摘要、版本、受控内容或文件对象引用 |
| schema_migrations | version PK、checksum、applied_at |

server Chat 使用 PostgreSQL 的同等逻辑表，按 owner/scope 查询；认证及 Provider 表见专门设计。第一版不强求两个数据库共享同一套 ORM entity；共享领域 Schema 和 Repository 接口，事务与索引分别实现。

Chat 另有 generations_projection（generation_id、input_id、candidate_index、status）及 message_selections_projection（input_id、selected_generation_id、revision）；由生成和选择事件重建，避免重新生成覆盖原回答。压缩操作和模型尝试有独立 ID，不能为了记录摘要请求伪造一个会执行工具的 Agent step。

MCP 增加目录对象、工具绑定/ToolSetSnapshot 和操作投影，保存请求语义及规范结果，具体字段见[MCP 持久数据](2026-11-02-praxis-mcp-security-design.md#9-持久数据与事件)。配置服务与 SecretStore 分开，不能把 token、OAuth verifier 或可续交的 opaque state 放进 Session。

不可变对象先写临时文件、同步并原子发布，然后在事务中引用；数据库提交失败留下未引用对象可回收，不能先提交一个尚不存在的文件路径。事务产生的事件通知从已提交序列读取，通知丢失不造成记录丢失。

## 8. Checkpoint 与恢复算法

快照是重放加速器，不是副作用回滚点。提议每完成一个 turn，以及活动期间每 200 个已提交事件或 30 秒建立快照；只在协调器可取得一致投影的边界捕获。快照包含 seq、格式、输入队列、上下文版本、当前计划、权限配置、活动执行引用和未解决调用，不保存内核句柄或可消费授权。

恢复顺序：

1. 取得数据目录锁，检查 Schema 和 Session 格式；未知新版本拒绝写入。
2. 校验最近快照校验和与 throughSeq；坏快照降级到前一有效快照或全量重放，坏事件不能静默跳过。
3. 从 throughSeq+1 重放事件，只构建状态，不执行模型、工具或插件副作用。
4. 找出未结束的 turn/attempt/tool/process；记录 interrupted 或 effectState=unknown，闭合协议中的未配对工具结果。
5. 将未领取输入标为 suspended，关闭旧问题与审批；清空文件观察权限状态，重新探测沙箱。
6. 展示恢复结果。用户显式 continue 接纳新输入并开始新 turn，先核对当前文件；旧任务不自动重跑。

未完成 MCP 操作同样标记 interrupted/unknown；checkpoint 只引用目录、工具集和操作状态，不恢复网络连接、旧 MCP session、OAuth 流程或 MRTR 续交。核查远端效果必须由新操作执行，不能通过重放工具调用实现“恢复”。

旧 process 的 PID 即使还存在也不能直接认领，防止 PID 复用。正常运行的父子死亡清理由平台执行器负责；无法证明归属的残留只报告，不随意杀进程。

## 9. 查询、导出、删除与迁移

历史以 `(sessionId,seq)` 游标分页，默认 100、最大 500。只读查询不恢复运行；归档只隐藏会话，不删历史。导出包含格式版本、事件及可选产物清单，必须脱敏；第一版只导出，不提供不可信备份直接可执行导入。

删除由用户显式操作，活动会话先取消并确认结束。事务记录独立审计及删除墓碑，撤销查询和产物权限，再异步清理文件；失败重试不让已删会话重新可见。共享对象按引用清理。不会因为上下文压缩删除原始历史。

Schema 迁移使用单调版本、迁移前备份、校验和及独占锁；失败恢复备份或拒绝启动，禁止部分迁移后继续写。事件旧版本通过纯 upcaster 读取，保留原事件；未知必需事件阻止重放，明确标为可忽略的诊断事件才允许跳过。

## 10. 验收

- 相同 requestId 内容相同仅接纳一次，不同内容报冲突；接纳响应之后崩溃仍能查到输入。
- LLM/人工等待不阻止 cancel，迟到结果不能恢复取消后的执行。
- queue、steer、最后一步完成之间的竞态不会丢输入或并行推进同一 Session。
- 每个 tool call 在正常、失败及恢复路径均有可解释的终态，未知副作用不自动重试。
- 从任意快照重放后的投影与完整事件重放一致，重放不调用任何外部执行器。
- 存储失败时不执行未落盘意图；数据库损坏、磁盘不足和未知格式不伪报成功。
- 重启保持 interrupted，历史与队列仍在；一次 continue 不自动授权旧 pending 输入。

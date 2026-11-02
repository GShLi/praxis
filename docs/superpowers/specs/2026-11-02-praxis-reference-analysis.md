# Praxis 设计参考：源码事实与采用范围

核对日期：2026-11-02。本文件集中记录参考依据；Praxis 的默认值和行为是自己的设计提案，不把项目之间相似的名称视为相同实现。

## 1. 参考版本与证据范围

| 项目 | 核对范围 |
| --- | --- |
| DeepSeek Harness | 本地 checkout `86a402200d95fecef4529d969836f1fe13c6cb0d`，Agent、inbox、提示词、Session 持久化、基础压缩、工具和沙箱源码/文档 |
| OpenCode | 本地 checkout `32b57015e5b491a789fba1534ecb472e676c9d8e`，当前 `packages/core` 的 Session、执行、压缩、指令和插件服务 |
| Codex | 本机启动器边界及 OpenAI 官方公开文档；本轮没有审计完整 Codex 核心源码，不据此断言其内部压缩或数据库算法 |

引用本地路径用于本工作空间核验；仓库更新后应按上述提交重新定位，不能把它们当成持续跟随最新版的结论。

## 2. 执行与输入

| 可核实事实 | 来源 | Praxis 采用/调整 |
| --- | --- | --- |
| DSH Agent 记录 turn/step、模型消息及工具阶段；inbox 区分下一 turn 与下一 step 输入 | [Agent](../../../../deepseek-harness/packages/core/agent-loop/src/agent.ts)、[Inbox](../../../../deepseek-harness/packages/core/agent-loop/src/inbox.ts) | queue/steer + 持久化领取；完成判定与新输入由协调器排序 |
| OpenCode 将输入入队与执行分开，delivered 投影消费待处理记录；Session 协调器管理单一推进者 | [Inbox](../../../../opencode/packages/core/src/session/inbox.ts)、[Coordinator](../../../../opencode/packages/core/src/session/run-coordinator.ts)、[仓库约定](../../../../opencode/AGENTS.md) | 接纳事务后才 accepted，通知仅唤醒；查询不会触发执行 |
| 当前 OpenCode step 驱动一次流式 LLM 过程，代码有工具调用事件执行路径 | [Step](../../../../opencode/packages/core/src/session/runner/step.ts) | 借鉴边界分层；Praxis 第一版等待完整 assistant message 后串行执行工具，降低流式副作用复杂度 |
| OpenCode 有启动后恢复未释放执行 claim 的逻辑及尝试上限 | [Restart](../../../../opencode/packages/core/src/session/execution/restart.ts) | 不采用自动恢复执行；Praxis 必须由用户继续，旧副作用不自动重放 |
| OpenCode 重试有预算与可中断等待 | [Retry](../../../../opencode/packages/core/src/session/runner/retry.ts) | 使用明确次数/耗时预算，但模型请求与工具副作用的重试规则分开 |

## 3. 历史、提示词与压缩

DSH 的原始 Session、模型表面与持久化职责分离；其默认持久实现为追加 `.jsonl.zstd`，有文件恢复与中断收尾规则。Praxis 借鉴不可因摘要删除历史的原则，选择 SQLite 事务事件与投影，不复制文件格式。依据：[Session Persistence](../../../../deepseek-harness/packages/session/session-persistence/README.md)。

DSH 基础压缩先考虑工具结果裁剪，再摘要最旧范围并保留近期内容，切分需要保持工具调用/结果配对。配置中的阈值默认比例为 0.8，headroom 默认 65,536，保留比例默认 0.16，并结合实际窗口与输出预算计算，不是对任意模型直接保留固定消息数。Praxis 采用“有预算、完整协议组、候选后原子提交”的流程，重新定义适配小窗口的限额。依据：[说明](../../../../deepseek-harness/packages/compaction/compaction-basic/README.md)、[配置](../../../../deepseek-harness/packages/compaction/compaction-basic/src/config.ts)、[范围](../../../../deepseek-harness/packages/compaction/compaction-basic/src/region.ts)、[配对](../../../../deepseek-harness/packages/compaction/compaction/src/tool-pairing.ts)。

当前 OpenCode 压缩代码包含摘要与 native compaction 分支、保留范围和后台预计算路径；不能将其整体简化成“删旧工具输出”。Praxis 借鉴结构化的目标/约束/工作状态/下一步摘要，第一版不实现后台预生成。依据：[Compaction](../../../../opencode/packages/core/src/session/compaction.ts)。

DSH 将稳定系统提示与运行上下文分开；OpenCode 指令处理保留来源与已注入历史关联。Praxis 将项目指令、运行事实和具体请求单独版本化，压缩后按当前来源重建。依据：[DSH System Prompt](../../../../deepseek-harness/packages/core/system-prompt/src/index.ts)、[OpenCode Instructions](../../../../opencode/packages/core/src/session/instructions.ts)。

## 4. 工具、插件与沙箱

内置工具的逐项源码对应关系已列于[工具设计第 1 节](2026-11-02-praxis-tools-design.md#1-设计目标与-dsh-参考)。Praxis 使用自己的 13 个工具合同，不因为参考 DSH 就引入持久 Shell、空闲自动新建 turn 或所有可选插件。

OpenCode 插件服务有激活代际和等待就绪的边界。Praxis 采用激活完成后发布注册表、活动 turn 固定版本的原则；第一版更新通过 Host 重启完成，不照搬其插件框架及运行时依赖。依据：[Plugin Service](../../../../opencode/packages/core/src/plugin/service.ts)。

DSH 沙箱选择涉及 Bubblewrap/Landlock、Seatbelt 和 Windows ACL 后端，其当前 Windows 后端明确报告 partial，部分 Landlock 能力也取决于 ABI。配置中的 full 只针对该实现声明的策略，不能证明 Praxis 额外的敏感读取、网络和进程边界。依据：[选择与能力](../../../../deepseek-harness/packages/sandbox/sandbox-local/src/index.ts)、[平台策略](../../../../deepseek-harness/packages/sandbox/sandbox-local/src/profiles.ts)。

因此 Praxis 提出分维度能力报告和失败即拒绝；Windows 考察 AppContainer，Linux 第一版不自动退回较弱后端。详见[沙箱设计](2026-11-02-praxis-sandbox-delivery-design.md)，候选机制需要真实系统验证。

## 5. Codex 的公开参考边界

- [App Server](https://learn.chatgpt.com/docs/app-server) 公布 Thread/Turn/Item、初始化、事件、引导/中断与审批等协议概念。Praxis 借鉴客户端与执行器分离和有明确身份的操作，但不复制所有端点，也不开放无沙箱执行入口。
- [认证文档](https://learn.chatgpt.com/docs/auth) 介绍其登录和 API Key 使用方式。Praxis 的平台身份与厂商 Key 分离来自本产品决定，不声称与 Codex 凭据路由完全相同。
- [审批与安全](https://learn.chatgpt.com/docs/agent-approvals-security) 区分沙箱限制和操作审批。Praxis 同样将策略、用户批准与实际 OS 执行分成三个责任。
- [AGENTS.md 指南](https://learn.chatgpt.com/docs/agent-configuration/agents-md) 提供分层项目指令的参考；Praxis 定义自己的发现范围、限额、来源快照和变更处理。

公开协议里的 compact 或 resume 能力，不足以推导内部摘要选择、checkpoint 保存字段或副作用 exactly-once 保证。本文不对这些缺少源码证据的内容作事实性比较。

## 6. 参考后保留的 Praxis 差异

1. 两种 Runtime：纯聊天不装载操作工具；Agent 才有工作区与执行器。
2. 客户端各自 Host，退出停止任务；重新打开只恢复状态，由用户继续。
3. 配置统一、模型本地直连；Web Chat 由服务器运行，各端 Session 独立。
4. 原始事件、上下文视图、请求快照、恢复 checkpoint 分别保存，不用摘要充当执行状态。
5. 工具调用、审批和副作用有独立身份；未知效果先核对，不能因重试策略自动重放。
6. 三平台实现相同策略合同；验证不过则拒绝对应执行，不以进程隔离或路径检查代替 OS 沙箱。

## 7. MCP 补充核对

补充更新：2026-11-03。

本轮仍核对第 1 节记录的两个本地提交。MCP 协议事实优先以明确版本的官方规范为准，不能从某项目的兼容注释推导所有服务器都如此实现。

| 参考 | 已核对事实 | Praxis 取舍 |
| --- | --- | --- |
| [DSH MCP Client](../../../../deepseek-harness/packages/mcp/mcp-client/README.md)、[工具适配](../../../../deepseek-harness/packages/mcp/mcp-client/src/tools.ts) | 服务器限定工具身份、稳定名称映射、目录代际替换、结果投影；要求 task 扩展的工具被拒绝 | 保留明确映射和完整目录提交，增加按需定义预算、冻结当前 turn 目录及审批绑定 |
| [DSH Transport](../../../../deepseek-harness/packages/mcp/mcp-client/src/transport.ts) | stdio 经过环境清理后由 SDK 启动，HTTP 使用对应 transport | 不直接复制该 spawn 路径；Praxis 所有服务/探测进程必须经过自己的 OS 沙箱与执行位 |
| [DSH Resources](../../../../deepseek-harness/packages/mcp/mcp-resources/README.md) | 以明确服务器为范围，按需列举与读取资源 | 采用显式资源来源，增加资源引用与缓存权限；另行设计用户选择 prompts |
| [OpenCode MCP Client](../../../../opencode/packages/core/src/mcp/client.ts) | 隔离 SDK 连接接口、新旧协议处理、工具/资源/模板接口及 elicitation；列表重试与业务请求路径分开 | 协议库止于适配层，业务操作不因断流自动重放 |
| [OpenCode Stdio](../../../../opencode/packages/core/src/mcp/stdio.ts) | 通过执行环境管理进程、帧缓冲和关闭流程 | 借鉴受管执行与有界缓冲；Praxis 使用自己的环境白名单和按操作回收合同 |

官方基线与实现校验入口：

- [版本与兼容](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)：新版逐请求信息和旧 initialize 分开；[stdio](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio)、[Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) 分别实现探测、传输及取消。
- [工具](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)、[资源](https://modelcontextprotocol.io/specification/2026-07-28/server/resources)、[提示词](https://modelcontextprotocol.io/specification/2026-07-28/server/prompts)：能力不同，Praxis 分别设计模型调用、按需材料和用户模板入口。
- [MRTR](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr)、[Elicitation](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation)：协议续交与用户提问不等于允许网络失败后重做业务操作。
- [授权](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)、[注册](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration)、[安全](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations)：Praxis 据此设计 issuer/resource/PKCE 绑定，不转发平台或模型 Key。
- [Roots](https://modelcontextprotocol.io/specification/2026-07-28/client/roots) 在该版是已弃用但保留的能力，且不提供访问控制；[Tasks](https://modelcontextprotocol.io/extensions/tasks/overview) 是单独的可选扩展。Praxis 的能力矩阵按明确支持范围声明。
- [官方 TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)：当前 v2 客户端支持本轮现代协议基线，具体发布版本必须在实现时锁定并验证，不能把 SDK 默认行为当作 Praxis 权限边界。

按操作启动 stdio、只暴露选中工具、MCP 凭据本地保存和第一版高级能力限制，均是 Praxis 的提案，不声称 DSH/OpenCode/Codex 全都采用这些选择。

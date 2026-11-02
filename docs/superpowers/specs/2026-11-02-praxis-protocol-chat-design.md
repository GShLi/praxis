# Praxis Host 协议、ChatRuntime 与生命周期设计

日期：2026-11-02。状态：详细提案。关联[执行与存储](2026-11-02-praxis-runtime-session-design.md)、[模型与认证](2026-11-02-praxis-model-auth-design.md)。不涉及界面布局。

## 1. 三类连接

| 连接 | 承载内容 | 生命周期 |
| --- | --- | --- |
| Web → Server：HTTPS JSON + SSE | 认证、Provider 管理、Web Chat 控制及事件 | 服务器常驻；单次生成绑定页面连接与超时 |
| 桌面 / CLI → 自己的 Host：私有 stdio | 本地 Session、Agent 控制、桌面 Chat、事件及受控认证桥 | 父进程退出，Host 退出 |
| Host → Server / Provider：HTTPS | 身份及配置 / 模型请求 | 由当前客户端和 turn 取消信号管理 |

业务契约在 contracts 中共享，传输适配分开。浏览器不能访问本地 Host 控制面；Host 不监听 localhost Agent HTTP/WebSocket。唯一新增例外是用户发起 MCP OAuth 时的短期 loopback callback，只接收该授权回调，不提供 Agent RPC。第一版没有远程 Agent RPC、后台 Host 服务或可脱离所属客户端的本地任务。

桌面 renderer 只接触 preload 暴露的有限类型方法；主进程验证参数和窗口身份，禁止 nodeIntegration、任意 IPC channel、任意命令和任意 URL 代理。外部网页不与可信控制界面共用权限。父进程是可信边界，不能让模型提供 Host 可执行文件、插件入口或启动参数。

## 2. 启动与协议握手

父进程从受控安装目录启动 Host，创建随机实例 nonce 和私有管道，发送 host/initialize。初始化包含 protocolMajor/minor、clientInstanceId、clientKind、nonce、已验证的数据目录及父进程身份；不得由模型字段覆盖。Host 回报版本、能力、Host 实例 ID、存储格式、沙箱探测和诊断。

协议主版本不匹配直接拒绝；次版本通过显式能力协商，只调用双方支持的方法。未完成握手只接受初始化和终止。nonce 用于实例绑定，不替代 OS 管道所有权和安装文件完整性；不记录到普通日志。

采用 JSON-RPC 2.0 风格的 UTF-8 JSON 行：一行一个帧，内容中的换行转义；不接受 batch。请求有 id，通知无 id；stdout 仅协议，stderr 仅脱敏诊断。最大帧 8 MiB，方法另外有更小输入限额；超长帧在解析前拒绝并关闭异常连接，不能无限缓冲。

示例：

```json
{"jsonrpc":"2.0","id":"rpc-21","method":"session/prompt","params":{"sessionId":"s-1","requestId":"req-7","mode":"queue","text":"创建一个输出 HelloWorld 的页面"}}
```

```json
{"jsonrpc":"2.0","id":"rpc-21","result":{"accepted":true,"inputId":"in-7","acceptedSeq":12}}
```

```json
{"jsonrpc":"2.0","method":"session/event","params":{"sessionId":"s-1","seq":13,"type":"turn/started","schemaVersion":1,"payload":{"turnId":"t-3"}}}
```

最后一例是精简的事件传输展示，完整事件仍含 eventId、时间及来源等公共字段。RPC id 只匹配这次连接的应答；业务 requestId 在持久存储作用域内去重，重连后可更换 RPC id 但复用 requestId。

## 3. Host 方法契约

所有方法运行时校验未知字段、大小、模式和归属。身份来自已认证 Host 上下文，不能靠 params.ownerUserId 选择别人。非接纳型的改变操作也以 requestId 和规范化参数摘要防止重复处理。

| 方法族 | 必要语义 |
| --- | --- |
| host/initialize、ping、shutdown、diagnostics | 握手、健康检查、有截止时间的退出、脱敏能力诊断 |
| auth/bind、auth/clear | 可信父进程绑定账号和内存凭据；独立秘密消息类型，禁止通用事件转发或追踪正文 |
| workspace/open、inspect、close | 用户选择路径、规范化及信任状态；返回 Workspace ID，不提供任意文件代理 |
| session/create、list、read、archive、delete、export | 类型与归属固定，分页查询；删除活动会话前先取消 |
| session/prompt | 持久化输入；Agent 支持 queue/steer，Chat 无活动生成时接受 |
| session/cancel | 接纳取消意图，指定 expectedTurnId 和 pendingDisposition=keep_suspended 或 cancel；默认保留但挂起 |
| session/continue | 仅对 interrupted 显式提交新输入，不隐式重放旧工具和队列 |
| session/resubmit-inputs | 显式选择 suspended 输入 ID，创建带新 requestId 的输入，并记录来源；不得重复领取原行 |
| session/set-permissions | 用户操作；Agent 专用，版本核对，影响后续调用 |
| session/set-budget | 用户操作；对指定活动 turn 设置有界上限，不能低于已消耗值或突破 Host 上限 |
| approval/respond、question/respond | 精确匹配请求、版本、turn 和未消费状态；响应不是新的模型授权字段 |
| session/subscribe、unsubscribe | 从 afterSeq 读取已提交事件，可重新同步 |
| chat/regenerate | 对最后一个已结束 Chat 回答创建新候选；不重复创建用户输入 |
| provider/list、update、replace-key | 访问统一服务的受控桥，不是本地另一套配置；普通查询无明文 Key |
| mcp/server-*、test、catalog-refresh、status | 用户管理和诊断 MCP，网络/进程测试是有界维护操作，不自动启动 Agent |
| mcp/auth-*、secret-replace、prompt-*、operation-cancel | 认证、用户模板与取消控制；参数和秘密通道合同见 MCP 安全设计，不是模型可用的任意 RPC |

取消所有活动操作、关闭 Workspace、切换账号必须先进入停止流程。切换账号后创建新的身份上下文及数据视图，不能把旧用户的 Session 或凭据重绑到新用户。旧本地记录可保留供原账号登录查看；本地存储的 OS 用户仍属于可信边界。

MCP 控制与外部 MCP 线协议分层：这里的 host/initialize 和 session/subscribe 始终是 Praxis 协议，不因为新版 MCP 移除初始化/改变 SSE 就改成另一种语义。具体映射见[MCP 控制 API](2026-11-02-praxis-mcp-security-design.md#10-host-控制-api)。

错误分成协议错误、鉴权错误、状态冲突、执行错误；对外统一 code、safeMessage、retryable、requestId、可选当前版本。取消应答仅表示接受取消，通过 turn/finished 或 Host 退出确认是否清理完成。

## 4. 持久事件、临时流与背压

持久事件按每个 Session 的 seq 排序。订阅流程为：注册实时缓冲 → 取得已提交高水位 → 回放 afterSeq 到高水位 → 按序排空缓冲 → 实时推送；也可以直接循环读取数据库游标。禁止“先查历史、再订阅”留下丢事件窗口。

客户端按 sessionId+seq 去重，只推进连续游标。收到跳号、resync_required 或断连后调用 read/subscribe 补齐；快照携带 throughSeq，随后读取增量。未提交的事件不得作为 accepted 或终态通知。

文本 delta 独立使用 attemptId、partId、deltaIndex；只提供及时显示，不承诺每个 delta 可重放。重连读取已保存 partial，完整 assistant/message 提交后替换对应临时内容，不能把两者累加成重复回答。

每个连接提议最多缓冲 8 MiB，持久事件回放单页最多 500 条且 512 KiB；大正文经内容引用分页读取。先合并或丢弃临时 delta，仍过载则发送 resync_required 并终止订阅，不阻塞存储和取消通道。stdio 物理通道断开与单一订阅取消不同：前者触发 Host 退出。

Web SSE 使用事件 ID `sessionId:seq`，校验 Last-Event-ID 与当前用户；跨会话或未来游标报错，不能泄漏其他用户存在性。临时 delta 无持久游标，连接恢复时同步正文投影。

## 5. ChatRuntime

ChatRuntime 和 AgentRuntime 共享 Provider、上下文预算、规范消息、存储接口和取消机制。ChatRuntime 不依赖 ToolExecutor、Workspace、ProcessRuntime 或操作型插件，运行在服务端或桌面 Host 都一样。

一次生成顺序：验证归属与单生成约束 → 保存输入与请求去重 → 取得配置快照 → 构建聊天上下文 → 必要时摘要 → 保存请求 → 流式生成 → 保存完成、失败或中断。配置取得失败的已接纳输入标为待重试/失败，不丢失，也不自动反复生成。

模型请求不携带任何工具 Schema。厂商异常返回工具调用时记录 `UNEXPECTED_TOOL_CALL` 并终止该生成，不临时切到 Agent。HTML、JavaScript 和命令仅作为内容；接口中不存在“自动运行代码块”。

每 Session 一个活动生成。并发新输入返回 `SESSION_BUSY`；相同 requestId 重试返回原结果。多个 Web 页面可查看同一用户 Web 历史，当前生成的断连生命周期绑定创建页面；同一账号其他页面仍可显式请求取消，权限按用户校验，第一版不引入平台控制租约。

Chat 提议总生成时间上限 10 分钟（含压缩和重试），取消或应用退出中止请求。部分输出保存 interrupted/incomplete，不能伪装成 completed。完成状态来自 Runtime，模型声称“文件已创建”不会产生文件执行事实。

## 6. 多轮与重新生成

同一 Chat 输入可有多个 assistant 候选；保存 generationId、inputId、candidateIndex、selectedCandidateId 和终态。上下文只取被选中的一个候选，不能把同一输入的多个版本都拼进去。

第一版仅允许重新生成会话最后一个已结束的回答，且其后没有新用户输入。重新生成不先删除旧回答；新候选成功后原子切换选中版本，失败保留旧选择。旧回答为 incomplete 时需用户显式决定继续聊天还是重生成。

每次已发送请求固定 message selection snapshot；选择候选改变后生成新的 Context View，若旧摘要覆盖了被替换内容则从原消息重建相关视图，不在旧摘要上追加相互冲突的新回答。编辑任意历史消息、复杂分支与跨端导入第一版暂不开放。

## 7. 父子进程与页面生命周期

本地父进程每 5 秒发送存活信号，Host 连续 15 秒未收到有效心跳或管道关闭即进入关闭；心跳逻辑放父进程而非 renderer，窗口渲染卡顿不能误判父进程死亡。系统睡眠恢复时以单调时钟和父进程通道重新核验，默认取消过期活动 turn，不在恢复后隐式续跑旧请求。

正常退出宽限期 5 秒，期间停止接纳、持久化取消、Abort 模型请求、结束命令、保存状态并关闭数据库。强杀由父进程及平台执行器协作，不能只杀 Host 留下命令。原生执行隔离和父死亡保障见[沙箱与交付](2026-11-02-praxis-sandbox-delivery-design.md)。

同一总宽限也涵盖 MCP stdio 子孙、HTTP 请求、OAuth callback 和维护操作，不能每个 Server 再额外等待一轮。关闭外部连接不保证撤销已提交的远端效果；Session 显示取消请求与效果未知，重启不恢复该连接或自动重试工具。

桌面最后一个窗口关闭即应用退出；切换模式或最小化不触发退出。CLI Ctrl-C 首次请求取消当前 turn，空闲时退出；连续第二次要求立即退出并执行有限清理。终端关闭、SIGTERM 和父进程崩溃均纳入测试。

Web 生成关联一个随机 pageInstanceId 和服务器管理的 stream lease。SSE 断开给 5 秒重连宽限，相同用户与页面可恢复；超时取消生成。服务器每 5 秒发 SSE 心跳，页面每 5 秒通过独立 HTTP heartbeat 请求续租；连续 15 秒没有有效续租即取消。SSE 单向消息本身不是客户端确认。后台标签页定时器节流可能导致取消，应按这个有限租期展示中断，不延长为后台无限生成。不能保证浏览器异常关闭可瞬时检测；客户端主动 cancel 只加快停止。

服务端正常关闭停止接纳、给活动 Chat 5 秒取消与提交，然后退出；重启标记旧生成 interrupted，不自动重发模型。第一版单服务实例，以数据库条件更新/唯一活动记录防止重复生成；多实例执行的持久租约及 fencing 留到平台阶段，不用进程内锁冒充集群协调。

## 8. 服务端 Chat HTTP 映射

提议 `/v1/chats` 创建/分页，`/v1/chats/:id/messages` 提交输入，`/v1/chats/:id/generations/:generationId/cancel` 取消，`/v1/chats/:id/generations/:generationId/heartbeat` 由所属页面续租，`/v1/chats/:id/regenerate` 创建候选，`/v1/chats/:id/events` SSE，`/v1/chats/:id/history` 分页读取。续租验证账号、页面实例及服务端随机租约凭据，其他观察页的连接不延长生成寿命。

写请求携带业务 requestId，返回 202 + 已接纳 ID；400 参数错误、401 未认证、403 无范围、404 不可见资源、409 冲突、429 限流、503 当前不可用。HTTP 成功不等于生成完成。服务端不提供任意本地路径、任意 Shell 或 Agent 工具调用路由。

## 9. 验收

- 相同契约通过 stdio 和 HTTP 适配后不改变持久化、去重、归属和取消语义。
- 版本不兼容、非法帧、stdout 杂音和超大请求可诊断，不执行半条命令。
- 在历史回放与实时订阅切换处注入事件，不丢失、不重复投影；慢客户端不阻塞 cancel。
- Chat 的伪造工具结果和模式切换请求不能取得本地工具能力；重新生成不污染后续上下文。
- Host 父进程退出、睡眠恢复、窗口关闭、CLI 中断、Web 断流、服务端重启均得到明确终态。
- 原账号退出后新账号不能查询原账号的会话，凭据桥不会向 renderer 广播秘密。
